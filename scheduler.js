const sleep = require('sleep');
const async = require('async');

const reviews = require('./reviews.js');
require('./constants.js');

var taskQueue = [];
var mainConfig;

exports.scheduleTask = function (appConfig) {
	if (mainConfig === undefined) {
		mainConfig = appConfig;

		if (!mainConfig.interval) {
        	mainConfig.interval = DEFAULT_INTERVAL_SECONDS;
    	}
	}

	taskQueue.push(appConfig);
};

exports.run = function () {
	if (mainConfig.verbose) console.log("INFO: Scheduler running...");

	async.eachSeries(taskQueue, function(task, next) {
		reviews.run(task, function(success) {
			if (success) { 
				next();
			} else {
				next(false); // Don't keep going on error, wait for next iteration
			}
		});
    }, function (error) {
    	if (error === null) {
    		if (mainConfig.verbose) console.log("INFO: Scheduler ran all queued tasks. Idling until next interval.");
    	} else {
    		if (mainConfig.verbose) console.log("ERROR: Scheduler did not complete all tasks. Idling until next interval.");
    	}
    		// Schedule again once done
    	setInterval(function () {
    		exports.run();
    	}, mainConfig.interval * 1000);
    })
}
