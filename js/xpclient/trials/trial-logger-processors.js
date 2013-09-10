/*jslint nomen: true, browser:true, strict:true, curly:false */
/*global define */

define(function () {


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
        
        eventTrialTime: function(log){
            var evNum, event;
            for(evNum in log.events){
                event = log.events[evNum];
                event.trialTime = event.timestamp - log.trialStartTimestamp;
            }
        }


    };


});