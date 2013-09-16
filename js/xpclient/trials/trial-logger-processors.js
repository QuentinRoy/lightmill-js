/*jslint nomen: true, browser:true, strict:true, curly:false */
/*global define */

define(['jstools/tools'], function (tools) {


    return {

        trialDuration: function (log) {
            if (log.trialEnd && log.trialStart) {
                log.trialDuration = log.trialEnd - log.trialStart;
                return true;
            }
            return false;
        },

        correctModeSelected: function (log, trialParams) {
            if (log.selectedMode) {
                log.correctModeSelected = trialParams.values.mode == log.selectedMode;
                return true;
            }
            return false;
        },

        eventTrialTime: function (log) {
            var evNum, event;
            for (evNum in log.events) {
                event = log.events[evNum];
                event.trialTime = event.timestamp - log.trialStartTimestamp;
            }
        },

        trialTrialTime: function (log) {
            if (log.trialEndTimestamp && log.trialStartTimestamp) {
                log.trialDuration = log.trialEndTimestamp - log.trialStartTimestamp;
                return true;
            }
            return false;
        },

        noviceUsed: function (log) {
            log.noviceUsed = !tools.isUnset(log.noviceTimestamp);
            return log.noviceUsed;
        },


    };
});