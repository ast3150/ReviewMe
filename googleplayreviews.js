const controller = require('./reviews');
const async = require('async');
const google = require('googleapis');
var playScraper = require('google-play-scraper');

exports.run = function (config, callback) {
    var appInformation = {};

    var scrape = playScraper.app({appId: config.appId})
    var timeout = new Promise(function(resolve, reject) {
        setTimeout(function() {
            reject('Timed out');
        }, 3000);
    });

    var race = Promise.race([
        scrape,
        timeout
    ]);
    
    race.then(function(appData) {
        if (config.verbose) console.log("INFO: [" + config.appId + "] Successfully scraped Google Play");

        appInformation.appName = appData.title;
        appInformation.appIcon = 'https:' + appData.icon;

        exports.fetchGooglePlayReviews(config, appInformation, function (entries) {
            exports.handleFetchedGooglePlayReviews(config, appInformation, entries, function (success) {
                callback(success);
            });
        });
    }).catch(function (error) {
        console.log("ERROR: [" + config.appId + "] Could not scrape Google Play, " + error);
        callback(false);
    })
}

exports.fetchGooglePlayReviews = function (config, appInformation, callback) {
    if (config.verbose) console.log("INFO: [" + config.appId + "] Fetching Google Play reviews");

    const scopes = ['https://www.googleapis.com/auth/androidpublisher'];

    //read publisher json key
    var publisherJson;
    try {
        publisherJson = JSON.parse(require('fs').readFileSync(config.publisherKey, 'utf8'));
    } catch (e) {
        console.warn(e)
    }

    var jwt;
    try {
        jwt = new google.auth.JWT(publisherJson.client_id, null, publisherJson.private_key, scopes, null);
    } catch (e) {
        console.warn(e)
    }

    jwt.authorize(function (err, tokens) {
        if (err) {
            console.log("ERROR: [" + config.appId + "] Could not authorize with Google Play, " + err);
            callback([]);
        }

        //get list of reviews using Google Play Publishing API
        google.androidpublisher('v2').reviews.list({
            auth: jwt,
            packageName: config.appId
        }, function (err, resp) {
            if (err) {
                console.log("ERROR: [" + config.appId + "] Could not fetch Google Play reviews, " + err);
                callback([]);
                return;
            }

            if (!resp.reviews) {
                if (config.verbose) console.log("INFO: [" + config.appId + "] Received no reviews from Google Play");
                callback([]);
                return;
            }

            if (config.verbose) console.log("INFO: [" + config.appId + "] Received reviews from Google Play");


            var reviews = resp.reviews.map(function (review) {

                var comment = review.comments[0].userComment;

                var out = {};
                out.id = review.reviewId;
                out.author = review.authorName;
                out.version = comment.appVersionName;
                out.versionCode = comment.appVersionCode;
                out.osVersion = comment.androidOsVersion;
                out.device = comment.deviceMetadata.productName;
                out.text = comment.text;
                out.rating = comment.starRating;
                out.link = 'https://play.google.com/store/apps/details?id=' + config.appId + '&reviewId=' + review.reviewId;
                out.storeName = "Google Play";

                return out;
            });

            callback(reviews);
        })

    });
};

exports.handleFetchedGooglePlayReviews = function (config, appInformation, reviews, callback) {    
    async.eachSeries(reviews, function(review, callback) {
        if (config.verbose) console.log("INFO: [" + config.appId + "] Handling fetched reviews");
        publishReview(appInformation, config, review, false, function (success) {
            if (!success) callback(false); // Don't keep going on error
            callback(); // Next iteration
        });
    }, function (success) {
        var success = success !== null ? success : true;
        if (config.verbose && reviews.length > 0) console.log("INFO: [" + config.appId + "] Done handling reviews");
        callback(success);
    })
};

function publishReview(appInformation, config, review, force) {
    controller.reviewPublished(review, function(published) {
        if (!(published) || force) {
            if (config.verbose) console.log("INFO: Received new review: " + JSON.stringify(review));
            var message = slackMessage(review, config, appInformation);
            controller.postToSlack(message, config, function (success) {
                if (success) {
                    if (config.verbose) console.log("INFO: Review successfully published: " + review.text);
                    controller.markReviewAsPublished(config, review);
                    callback(true);
                } else {
                    console.log("ERROR: Review could not be published: " + review.text);
                    callback(false);
                }
            });
        } else if (!force) {
            if (config.verbose) console.log("INFO: Review already published: " + review.text);
            callback(true);
        }
    });
}

var slackMessage = function (review, config, appInformation) {
    if (config.verbose) console.log("INFO: Creating message for review " + review.title);

    var stars = "";
    for (var i = 0; i < 5; i++) {
        stars += i < review.rating ? "★" : "☆";
    }

    var color = review.rating >= 4 ? "good" : (review.rating >= 2 ? "warning" : "danger");

    var text = "";
    text += review.text + "\n";

    var footer = "";
    if (review.version) {
        footer += " for v" + review.version + ' (' + review.versionCode + ') ';
    }

    if (review.osVersion) {
        footer += ' Android ' + getVersionNameForCode(review.osVersion)
    }

    if (review.device) {
        footer += ', ' + review.device
    }

    if (review.link) {
        footer += " - " + "<" + review.link + "|" + appInformation.appName + ", " + review.storeName + ">";
    } else {
        footer += " - " + appInformation.appName + ", " + review.storeName;
    }

    var title = stars;
    if (review.title) {
        title = title + " – " + review.title;
    }

    return {
        "username": config.botUsername,
        "icon_url": config.botIcon,
        "channel": config.channel,
        "attachments": [
        {
            "mrkdwn_in": ["text", "pretext", "title", "footer"],

            "color": color,
            "author_name": review.author,

            "thumb_url": appInformation.appIcon,

            "title": title,

            "text": text,
            "footer": footer
        }
        ]
    };
};

var getVersionNameForCode = function (versionCode) {
    if (versionCode == 14) {
        return "4.0"
    }

    if (versionCode == 15) {
        return "4.0.3"
    }

    if (versionCode == 16) {
        return "4.1"
    }

    if (versionCode == 17) {
        return "4.2"
    }

    if (versionCode == 18) {
        return "4.3"
    }

    if (versionCode == 19) {
        return "4.4"
    }

    if (versionCode == 20) {
        return "4.4W"
    }

    if (versionCode == 21) {
        return "5.0"
    }

    if (versionCode == 22) {
        return "5.1"
    }

    if (versionCode == 22) {
        return "5.1"
    }

    if (versionCode == 23) {
        return "6.0"
    }

    if (versionCode == 24) {
        return "7.0"
    }

    if (versionCode == 25) {
        return "7.1"
    }

    if (versionCode == 26) {
        return "8.0"
    }
};