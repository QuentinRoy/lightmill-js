define(['jstools/tools', 'jquery', 'fiber', './dot-notation'], function(tools, $, Fiber, dot) {
    "use strict";

    return Fiber.extend(function() {

        return {

            init: function(processor_s, settings) {
                this._log = {};
                settings = settings || {};

                if (typeof processor_s == "function") {
                    this.processors = [processor_s];
                } else if (processor_s) {
                    this.processors = processor_s.slice(0);
                } else {
                    this.processors = [];
                }

                // TODO: use this to protect listed values (mark them as unmodifiable)
                this.protectedValues = settings.protectedValues || [];
                this.processorParams = settings.processorParams;
            },


            timestamp: function(measureNameOrArrayOfMeasureNames) {
                var timeStamp = new Date().getTime(),
                    _this = this;
                if (typeof measureNameOrArrayOfMeasureNames === 'string') {
                    this.set(measureNameOrArrayOfMeasureNames, timeStamp);
                } else {
                    $.each(measureNameOrArrayOfMeasureNames, function(num, val) {
                        if (typeof val !== 'string')
                            throw "measureName must be a string";
                        _this.set(val, timeStamp);
                    });
                }
            },

            get: function(measurePath) {
                return dot.get(this._log, measurePath);
            },

            set: function(measureNameOrMeasuresObj, measure) {
                dot.set(this._log, measureNameOrMeasuresObj, measure, 'factorized');
                return this;
            },

            _applyProcessor: function(processor) {
                return processor(this, this.processorParams || {});
            },

            _applyProcessors: function() {
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
                        // apply the precessor
                        result = this._applyProcessor(process);
                        if (tools.isUnset(result) || result) {
                            applied++;
                        } else {
                            nextProcToApply.push(process);
                        }
                    }
                } while (applied > 0 && nextProcToApply.length > 0);
            },

            export: function() {
                var log = {};
                this._applyProcessors();
                $.extend(true, log, this._log);
                return log;
            },

            getToken: function() {
                this._givenToken++;
            },

            releaseToken: function() {
                this._givenToken--;
            },

            isFree: function() {
                return this._givenToken <= 0;
            },

        };
    });


});
