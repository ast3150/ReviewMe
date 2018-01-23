const controller = require('./reviews');
const request = require('request');
const async = require('async');
require('./constants');

exports.run = function (config, region, callback) {
    const appInformation = {};
    appInformation.region = region;

    exports.fetchAppStoreReviews(config, appInformation, function (entries) {
        exports.handleFetchedAppStoreReviews(config, appInformation, entries, function (success) {
            callback(success);
        });
    });
}

exports.fetchAppStoreReviews = function (config, appInformation, callback) {
    if (config.verbose) console.log("INFO: [" + config.appId + "] Fetching App Store reviews");

    const url = "https://itunes.apple.com/" + appInformation.region + "/rss/customerreviews/id=" + config.appId + "/sortBy=mostRecent/json";

    request(url, function (error, response, body) {
        if (error) {
            if (config.verbose) {
                console.log("ERROR: [" + config.appId + "] Error fetching reviews from App Store (" + appInformation.region + ")");
                console.log(error)
            }
            callback([]);
            return;
        }

        var rss = JSON.parse(body);
        var entries = rss.feed.entry;

        if (!entries) {
            if (config.verbose) console.log("INFO: [" + config.appId + "] Received no reviews from App Store (" + appInformation.region + ")");
            callback([]);
            return;
        }

        if (config.verbose) console.log("INFO: [" + config.appId + "] Received reviews from App Store (" + appInformation.region + ")");

        updateAppInformation(config, entries, appInformation);

        var reviews = entries
            .filter(function (review) {
                return !isAppInformationEntry(review)
            })
            .reverse()
            .map(function (review) {
                return exports.parseAppStoreReview(review, config, appInformation);
            });
        callback(reviews)
    });
};


exports.handleFetchedAppStoreReviews = function (config, appInformation, reviews, callback) {
    if (config.verbose) console.log("INFO: [" + config.appId + "] Handling fetched reviews");

    async.eachSeries(reviews, function(review, callback) {
        publishReview(appInformation, config, review, false, function (success) {
            if (!success) callback(false); // Don't keep going on error
            callback(); // Next iteration
        });
    }, function (success) {
        var success = success !== null ? success : true;
        if (config.verbose) console.log("INFO: [" + config.appId + "] All Reviews Handled " + (success ? "successfully" : " Some errors occurred."));
        callback(success);
    })
};

exports.parseAppStoreReview = function (rssItem, config, appInformation) {
    var review = {};

    review.id = rssItem.id.label;
    review.version = reviewAppVersion(rssItem);
    review.title = rssItem.title.label;
    review.appIcon = appInformation.appIcon;
    review.text = rssItem.content.label;
    review.rating = reviewRating(rssItem);
    review.author = reviewAuthor(rssItem);
    review.link = config.appLink ? config.appLink : appInformation.appLink;
    review.storeName = "App Store";
    return review;
};

function publishReview(appInformation, config, review, force, callback) {
    controller.reviewPublished(review, function(published) {
        if (!(published) || force) {
            if (config.verbose) console.log("INFO: [" + config.appId + "] Received new review");
            var message = slackMessage(review, config, appInformation);
            controller.postToSlack(message, config, function (success) {
                if (success) {
                    if (config.verbose) console.log("INFO: [" + config.appId + "] Review successfully published");
                    controller.markReviewAsPublished(config, review);
                    callback(true);
                } else {
                    console.log("ERROR: [" + config.appId + "] Review could not be published");
                    callback(false);
                }
            });
        } else if (!force) {
            callback(true);
        }
    });
}

var reviewRating = function (review) {
    return review['im:rating'] && !isNaN(review['im:rating'].label) ? parseInt(review['im:rating'].label) : -1;
};

var reviewAuthor = function (review) {
    return review.author ? review.author.name.label : '';
};

var reviewAppVersion = function (review) {
    return review['im:version'] ? review['im:version'].label : '';
};

// App Store app information
var updateAppInformation = function (config, entries, appInformation) {
    for (var i = 0; i < entries.length; i++) {
        var entry = entries[i];

        if (!isAppInformationEntry(entry)) continue;

        if (!config.appName && entry['im:name']) {
            appInformation.appName = entry['im:name'].label;
        }

        if (!config.appIcon && entry['im:image'] && entry['im:image'].length > 0) {
            appInformation.appIcon = entry['im:image'][0].label;
        }

        if (!config.appLink && entry['link']) {
            appInformation.appLink = entry['link'].attributes.href;
        }
    }
};

var isAppInformationEntry = function (entry) {
    // App information is available in an entry with some special fields
    return entry && entry['im:name'];
};

var slackMessage = function (review, config, appInformation) {
    if (config.verbose) console.log("INFO: [" + config.appId + "] Creating message for review");

    var stars = "";
    for (var i = 0; i < 5; i++) {
        stars += i < review.rating ? "★" : "☆";
    }

    var color = review.rating >= 4 ? "good" : (review.rating >= 2 ? "warning" : "danger");

    var text = "";
    text += review.text + "\n";

    var footer = "";
    if (review.version) {
        footer += " for v" + review.version;
    }

    if (review.link) {
        footer += " - " + "<" + review.link + "|" + appInformation.appName + ", " + review.storeName + " (" + appInformation.region + ") >";
    } else {
        footer += " - " + appInformation.appName + ", " + review.storeName + " (" + appInformation.region + ")";
    }

    var title = stars;
    if (review.title) {
        title += " – " + review.title;
    }

    return {
        "username": config.botUsername,
        "icon_url": config.botIcon,
        "channel": config.channel,
        "attachments": [
            {
                "mrkdwn_in": ["text", "pretext", "title"],
                "color": color,
                "author_name": review.author,

                "thumb_url": review.appIcon ? review.appIcon : appInformation.appIcon,

                "title": title,
                "text": text,
                "footer": footer
            }
        ]
    };
};
