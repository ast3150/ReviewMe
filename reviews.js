const request = require('request');
const deasync = require('deasync');
const appstore = require('./appstorereviews.js');
const googlePlay = require('./googleplayreviews.js');

const IncomingWebhook = require('@slack/client').IncomingWebhook;
var webhook;

var Datastore = require('nedb');

const REVIEWS_STORES = {
    "APP_STORE": "app-store",
    "GOOGLE_PLAY": "google-play"
};

var publishedReviews = new Datastore({
    filename: './publishedReviews',
    autoload: true
});

(function () {
    exports.start = function start(config) {
        if (!config.store) {
            // Determine from which store reviews are downloaded
            config.store = (config.appId.indexOf("\.") > -1) ? REVIEWS_STORES.GOOGLE_PLAY : REVIEWS_STORES.APP_STORE;
        }

        if (config.store === REVIEWS_STORES.APP_STORE) {
            appstore.startReview(config);
        } else {
            googlePlay.startReview(config)
        }
    }
}).call(this);


// Published reviews
exports.markReviewAsPublished = function (config, review) {
    if (!review || !review.id) return;

    this.reviewPublished(review, function(published) {
        if (!published) {
            publishedReviews.insert([{ _id: review.id }], function (err) {
                if (typeof err !== 'undefined' && err) {
                    console.log(err);
                }
            });
        }
    });
};

exports.reviewPublished = function (review, published) {
    if (!review || !review.id) return false;
    publishedReviews.find({ _id: review.id}, function(err, docs) {
        var value = docs.length > 0;
        published(value);
    });
};

exports.resetPublishedReviews = function () {
    publishedReviews.remove({}, { multi: true }, function (err, numRemoved) {
    });
};

exports.welcomeMessage = function (config, appInformation) {
    var storeName = appStoreName(config);
    var appName = config.appName ? config.appName : (appInformation.appName ? appInformation.appName : config.appId);
    return {
        "username": config.botUsername,
        "icon_url": config.botIcon,
        "channel": config.channel,
        "attachments": [
        {
            "mrkdwn_in": ["pretext", "author_name"],
            "fallback": "This channel will now receive " + storeName + " reviews for " + appName,
            "pretext": "This channel will now receive " + storeName + " reviews for ",
            "author_name": appName,
            "author_icon": config.appIcon ? config.appIcon : appInformation.appIcon
        }
        ]
    }
};

exports.postToSlack = function (message, config, success) {
    if (typeof webhook === 'undefined') {
        webhook = new IncomingWebhook(config.slackHook);
    }

    var messageJSON = JSON.stringify(message);
    if (config.verbose) {
        console.log("INFO: Posting new message to Slack: ");
        console.log("INFO: Hook: " + config.slackHook);
        console.log("INFO: Message: " + messageJSON);
    }

    return webhook.send(message, function(err, res) {
        if (err) {
            console.log("ERROR: Could not send Slack message: " + err);
            success(false);
            return;
        } else {
            success(true);
            return;
        }
    });
};


var appStoreName = function (config) {
    return config.store === REVIEWS_STORES.APP_STORE ? "App Store" : "Google Play";
};
