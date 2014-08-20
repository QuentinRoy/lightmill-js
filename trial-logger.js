define(['jstools/tools', 'jquery', './logger', 'signals'], function(tools, $, Logger, Signal) {
    'use strict';


    return Logger.extend(function(base) {

        // if args starts by an evt (contains timestamp and type)
        // returns an array containing timestamp and type and the remaining of the arguments
        // else returns the original arguments
        function _normalizeEvtArgs(args) {
            var n = args.length;
            if (n < 1) return args;
            var evt = args[0];
            var timestamp = tools.isSet(evt.timestamp) ? evt.timestamp : evt.timeStamp,
                type = evt.type;
            if (timestamp && type) {
                var newArgs = [timestamp, type];
                for (var i = 1; i < n; i++) newArgs.push(args[i]);
                return newArgs;
            }
            return args;
        }

        // wrap a function so that the arguments are automatically normalized
        function _eventDecorator(f, context) {
            return function() {
                var fcontext = context == void(0) ? this : context;
                var args = _normalizeEvtArgs(arguments);
                return f.apply(fcontext, args);
            };
        }

        return {

            init: function(trialProcessors, eventProcessors, settings) {
                base.init.call(this, trialProcessors, settings);
                settings = settings || {};

                if (typeof processor_s == 'function') {
                    this.eventProcessors = [eventProcessors];
                } else if (eventProcessors) {
                    this.eventProcessors = eventProcessors.slice(0);
                } else {
                    this.eventProcessors = [];
                }

                // this can be used to store values that are going to be repeted on all events
                this.constants = {};

                this._evtIndex = {}; // _evtIndex[evtIndex][evtTime] = evt
                this._events = [];

                var that = this;
                this._pointerHandlers = {
                    'touchstart touchend touchmove touchcancel mousesup mousedown mousemove': function(evt) {
                        that.setPointerEvent(evt);
                    },
                };
                this._logPointerEvents = false;
                this.logPointerEvents(settings.logPointerEvents);
                this.eventProcessorParams = settings.eventProcessorParams;

                this.onEvent = new Signal();
            },

            createEvent: function(evtTime, evtType) {
                return this._createEvent(evtTime, evtType);
            },

            forEachEvent: function(f) {
                this._events.every(function(evt, i) {
                    if (f(evt, i) === false) return false;
                    else return true;
                });
            },

            eventCount: function() {
                return this._events.length;
            },

            lastEvent: function() {
                return this._events[this._events.length - 1];
            },

            _pushNewEvent: function(evt) {
                var prevI = this._events.length - 1,
                    prev = this._events[prevI],
                    timestamp = evt.get('timestamp');
                // look for the position of the event in the list
                // (usually, it should always be the last)
                while (prev.get('timestamp') > timestamp) {
                    prevI--;
                    prev = this._events[prevI];
                }
                this._events.splice(prevI + 1, 0, evt);
            },

            // evtTime & evtType can be replace by an event
            _createEvent: _eventDecorator(function(evtTime, evtType, noSignal) {
                var evt = new Logger(this.eventProcessors, {
                        processorParams: $.extend({
                            trialLogger: this
                        }, this._eventProcessorParams)
                    }),
                    types = this._evtIndex[evtType] || {};
                this._evtIndex[evtType] = types;
                if (types[evtTime]) throw 'Event already exists: ' + evtType + ' (' + evtTime + ')';
                evt.set('timestamp', evtTime);
                evt.set('type', evtType);
                evt.protectedValues.push('timestamp');
                evt.protectedValues.push('type');
                evt.set(this.constants);
                types[evtTime] = evt;
                this._events.push(evt);
                evt._pointerRegistered = false;
                if (!noSignal) this.onEvent.dispatch(evt);
                return evt;
            }),

            // evtTime & evtType can be replace by an event
            getEvent: _eventDecorator(function(evtTime, evtType, createUnfound) {
                var types = this._evtIndex[evtType],
                    evt;
                if (types) evt = types[evtTime];
                if (!evt && createUnfound) evt = this.createEvent(evtTime, evtType);
                return evt;
            }),

            eventExists: function() {
                return Boolean(this.getEvent.apply(this, arguments));
            },

            // evtTime & evtType can be replace by an event
            setEvent: _eventDecorator(function(evtTime, evtType, measureNameOrMeasuresObj, measure) {
                var evtLog = this.getEvent(evtTime, evtType);
                if (!evtLog) {
                    evtLog = this._createEvent(evtTime, evtType, true);
                    evtLog.set(measureNameOrMeasuresObj, measure);
                    this.onEvent.dispatch(evtLog);
                } else {
                    evtLog.set(measureNameOrMeasuresObj, measure);
                }
                return evtLog;
            }),

            export: function() {
                // this._events should remain sorted
                var sortedEvents = this._events;
                var eventExports = [];
                var n = sortedEvents.length;
                var i;
                for (i = 0; i < n; i++) {
                    // event processors are applied before trial processors
                    base._applyProcessors.call(sortedEvents[i]);
                }
                var trialExport = base.export.call(this);
                for (i = 0; i < n; i++) {
                    // however the event logs are exported after the trial processors
                    // because they may act on events
                    var event = sortedEvents[i];
                    eventExports.push($.extend(true, {}, event._log));
                }
                return {
                    trial: trialExport,
                    events: eventExports
                };
            },

            logPointerEvents: function(mustLog, targetDiv) {
                if (tools.isSet(mustLog)) {
                    // register the old targetDiv
                    var oldTargetDiv = this._pointersDiv;
                    // register the new div to follow
                    this._pointersDiv = $(targetDiv || oldTargetDiv || document);
                    // check we are not already following this div
                    var different = this._pointersDiv !== targetDiv;
                    // remove the old handlers if needed
                    if (this._logPointerEvents && (different || !mustLog)) {
                        $(oldTargetDiv).off(this._pointerHandlers);
                    }
                    // add the new one if needed
                    if (mustLog && different) {
                        $(this._pointersDiv).on(this._pointerHandlers);
                    }
                    this._logPointerEvents = mustLog;
                }
                return this._logPointerEvents;
            },

            setPointerEvent: function(event, log) {
                // retrieve the original event (jquery event case)
                event = event.originalEvent || event;
                // get the event log associated to this event
                var eventLog = this.getEvent(event);
                // if there is no eventLog, we will trigger the signal at the end
                // of this set command
                var dispatch = !eventLog;
                // create (if needed) the event log with no signal option
                eventLog = eventLog || this._createEvent(event, true);
                // if we did not already registered the pointer, we register them
                if (!eventLog._pointerRegistered) {
                    // get the pointer log and register it
                    eventLog.set(this._getPointerLog(event));
                    // flag the event log
                    eventLog._pointerRegistered = true;
                }
                // set user log *after* the pointer log (so it can be overwritten)
                eventLog.set(log);
                // dispatch the event if we created the event log here
                if(dispatch) this.onEvent.dispatch(eventLog);
            },

            _getPointerLog: function(event, target){
                target = target || {};
                // else we register the pointers
                var touches = (event.originalEvent || event).touches,
                    n = touches ? touches.length : 0,
                    i, touch,
                    pointersLog = target.pointers || {};
                target.pointers = pointersLog;
                pointersLog.count = n;
                for (i = 0; i < n; i++) {
                    touch = touches[i];
                    pointersLog[i] = {
                        identifier: touch.identifier,
                        x: touch.pageX,
                        y: touch.pageY
                    };
                }
                if (n > 0) {
                    pointersLog.mean = {
                        x: event.pageX,
                        y: event.pageY
                    };
                }
                return target;
            }

        };
    });

});
