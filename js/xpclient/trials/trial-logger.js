/*jslint nomen: true, browser:true, strict:true, curly:false */
/*global define */


define(['jstools/tools', 'classy', 'jquery'], function (tools, Class, $) {
    "use strict";


    return Class.$extend({

        __init__: function (trialParams, processor_s) {
            this._log = {};

            this._events = [];

            if (typeof processor_s == "function") {
                this.processors = [processor_s];
            } else if (processor_s){
                this.processors = processor_s.slice(0);
            } else {
                this.processors = [];
            }

            this.trialParams = trialParams;
        },

        trialTime: function () {
            return this._log.timestamps.trialStart - new Date().getTime();
        },
        

        timestamp: function (measureName) {
            if (typeof measureName !== 'string') throw "measureName must be a string";
            this.set(measureName, new Date().getTime());
        },
        
        beforeEvent: function(event) {
            return event;  
        },


        _makePaths: function (objPath, prefix) {
            var paths = [],
                subsubPaths, subPath;
            prefix = tools.isSet(prefix) ? prefix : '';
            if (typeof objPath === 'string') {
                paths.append(prefix + ':' + objPath);
            } else {
                for (subPath in objPath) {
                    subsubPaths = this._makePaths(objPath, prefix + '.' + subPath);
                    paths = paths.concat(subsubPaths);
                }
            }
            return paths;
        },

        // because we love magic
        _resolvePath: function (strPath, val) {
            var objPath = {},
                last = objPath,
                lastName = null,
                splitName = strPath.split('.'),
                pathI;
            for (pathI in splitName) {
                if (lastName) {
                    last = last[lastName] = {};
                }
                lastName = splitName[pathI];
            }
            last[lastName] = val;
            return objPath;
        },
        
        // because we love magic
        _resolvePaths: function (obj) {
            var propPath, propVal, subObj, newObj = {};
            for (propPath in obj) {
                propVal = obj[propPath];
                propVal = propVal instanceof Object ? this._resolvePaths(propVal) : propVal;
                subObj = this._resolvePath(propPath, propVal);
                $.extend(true, newObj, subObj);
            }
            return newObj;
        },

        set: function (measureNameOrMeasuresObj, measure) {
            var objPath;
            if (typeof measureNameOrMeasuresObj === 'string') {
                objPath = this._resolvePath(measureNameOrMeasuresObj, measure);
            } else {
                objPath = this._resolvePaths(measureNameOrMeasuresObj);
            }
            $.extend(true, this._log, objPath);
        },

        addEvent: function (event) {
            var resolvedEvent = this.beforeEvent(this._resolvePaths(event));
            this._events.push(this._resolvePaths(resolvedEvent));
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