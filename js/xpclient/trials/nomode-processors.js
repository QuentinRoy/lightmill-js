/*jslint nomen: true, browser:true, strict:true, curly:false */
/*global define */

define(['jstools/tools'], function (tools) {


    var module = {

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
                event.trialTime = event.timestamps.event - log.timestamps.trialStart;
            }
        },

        noviceUsed: function (log) {
            log.noviceUsed = !tools.isUnset(log.timestamps.novice);
            return log.noviceUsed;
        },

        all: function () {
            var processors = [];
            for (var proc in module) {
                if (!proc.startsWith('_')) processors.push(module[proc]);
            }
            return processors;
        }

    };

    function createDurationProcessor(name, interval) {
        var endName = interval[1],
            startName = interval[0];
        return function (log) {
            var timestamps = log.timestamps,
                dur = timestamps[endName] - timestamps[startName];
            if (dur || dur === 0) {
                log['durations.' + name] = dur;
                return true;
            }
            return false;
        };
    }

    function registerDurationProcessors(durations, container, suffix) {
        var durationName;
        suffix = tools.isUnset(suffix)?'Duration':suffix;
        container = container || {};
        for (durationName in durations) {
            container[durationName + suffix] = createDurationProcessor(durationName, durations[durationName]);
        }
        return container;
    }

    var durations = {
        reaction: ['trialStart', 'executionStart'],
        triggering: ['executionStart', 'trigger'],
        selection: ['trigger', 'selection'],
        control: ['selection', 'executionEnd'],
        noviceTriggering: ['trigger', 'novice'],
        novice: ['novice', 'selection'],
        execution: ['executionStart', 'executionEnd'],
        trial: ['trialStart', 'trialEnd']
    };

    registerDurationProcessors(durations, module);

    return module;
});