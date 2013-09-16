/*jslint nomen: true, browser:true, strict:true, curly:false */
/*global define */


define(['./trial-logger-processors', 'jstools/tools', 'classy', 'jquery'], function (processors, tools, Class, $) {
    "use strict";


    return Class.$extend({

        __init__: function (trialParams, processor_s) {
            this._log = {};

            this._events = [];

            if (typeof processor_s == "Array") {
                this.processors = processor_s.slice(0);
            } else if (typeof processor_s == "Function") {
                this.processors = [processor_s];
            } else {
                this.processors = [];
                for (var proc in processors) {
                    this.processors.push(processors[proc]);
                }
            }

            this.trialParams = trialParams;
        },

        trialTime: function () {
            return this._log.trialStartTimestamp - new Date().getTime();
        },

        trialStart: function (startTime) {
            if (this._log.trialStartTimestamp) throw "Already started.";
            this._log.trialStartTimestamp = startTime || new Date().getTime();
        },

        trialEnd: function (endTime) {
            if (!this._log.trialStartTimestamp) throw "Not started.";
            if (this._log.trialEndTimestamp) throw "Alreaded ended.";
            endTime = endTime || new Date().getTime();
            if (endTime < this._log.trialStartTimestamp) throw "End time lesser than start time";
            this._log.trialEndTimestamp = endTime;
        },

        set: function (measuresOrMeasureName, measure) {
            if (typeof measuresOrMeasureName === "string") {
                this._log[measuresOrMeasureName] = measure;
            } else {
                for (measure in measuresOrMeasureName) {
                    this._log[measure] = measuresOrMeasureName[measure];
                }
            }
            return this;
        },

        addEvent: function (event) {
            this._events.push(event);
        },

        _applyProcessors: function (log) {
            var nextProcToApply = this.processors,
                procToApply,
                applied,
                process,
                procNum,
                result;
            do {
                applied = 0;
                procToApply = nextProcToApply;
                nextProcToApply = [];
                for (procNum in procToApply) {
                    process = procToApply[procNum];
                    result = process(log, this.trialParams);
                    if (tools.isUnset(result) || result) {
                        applied++;
                    } else {
                        nextProcToApply.push(process);
                    }
                }
            } while (applied > 0 && nextProcToApply.length > 0);
        },

        getLog: function () {
            var log = {};
            $.extend(true, log, this._log);
            log.events = this._events.splice(0);
            this._applyProcessors(log);
            return log;
        },

    });



});