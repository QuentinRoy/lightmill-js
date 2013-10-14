define(['jstools/tools', './test-task', 'toolbar', 'jquery', 'fastclick'], function (tools, TestTask, Toolbar, $) {
    "use strict";

    return TestTask.$extend({

        __init__: function (mainDiv, params) {
            this.$super(mainDiv, params);
            this._toolbar = null;
            this._callbacks = this._createCallbacks();
            this._tracking = false;
            this._pointerType = null;
            this._pointerId = null; // record the identifier of the contact point
            this._previousPointerPos = null;
            this._state = 'idle';

            this._handlers = {
                "mousedown touchstart": $.proxy(this._onPointerStart, this),
                "mousemove touchmove": $.proxy(this._onPointerMove, this),
                "mouseup touchend touchcancel": $.proxy(this._onPointerEnd, this)
            };
        },

        get tracking() {
            return this._tracking;
        },


        _createDOM: function () {
            this.$super();
            this._toolbar = new Toolbar(this._techniqueDiv, this._callbacks, {
                buttonWidth: 80,
                spread: true,
                logger: this._logger
            });
        },

        _taskParams: function () {
            var res = this.$super(),
                targetLabel = this._modeMapping[this._targetMode].name,
                button = this._toolbar.getButton(targetLabel);
            res.targetCenter = tools.centerOf(button);
            return res;
        },

        _initTechnique: function () {
            var targetLabel = this._modeMapping[this._targetMode].name;
            this._logger.set({
                'toolbar.targetButton': this._getButtonLogParams(targetLabel),
            });

        },

        _createCallbacks: function () {
            var modeId, callbacks = {}, modeLabel;
            for (modeId in this._modeMapping) {
                modeLabel = this._modeMapping[modeId].name;
                callbacks[modeLabel] = this._createCallback(modeId);
            }
            return callbacks;
        },

        _createCallback: function (modeId) {
            var that = this;
            return function (label, evt) {
                if (!that.tracking) that._click(modeId, label, evt);
            };
        },

        _getButtonLogParams: function (buttonName) {
            var button = this._toolbar.getButton(buttonName),
                buttonCenter = tools.centerOf(button);

            return {
                'center.x': buttonCenter[0],
                'center.y': buttonCenter[1],
                width: button.outerWidth(),
                height: button.outerHeight(),
                position: this._toolbar.getButtonPosition(buttonName)
            };
        },


        _buildPEvent: function (evt) {
            var pointerType = this._EVT_MAP[evt.type],
                touchNum, touch, pos;
            if (pointerType === this._pointerType) {
                if (pointerType === 'touch') {
                    // find the touch
                    for (touchNum in evt.originalEvent.changedTouches) {
                        touch = evt.originalEvent.changedTouches[touchNum];
                        if (touch.identifier === this._pointerId) {
                            pos = [touch.pageX, touch.pageY];
                            break;
                        }
                    }
                    if (!pos) return;
                } else {
                    pos = [evt.originalEvent.pageX, evt.originalEvent.pageY];
                }
                return {
                    pointerType: pointerType,
                    type: this._EVT_TYPES[evt.type],
                    pos: pos,
                    jqueryEvent: evt,
                    timeStamp: evt.timeStamp,
                    originalEvent: evt.originalEvent
                };
            }
            return null;
        },


        _EVT_MAP: {
            touchstart: "touch",
            touchcancel: "touch",
            touchend: "touch",
            touchmove: "touch",
            mousedown: "mouse",
            mouseup: "mouse",
            mousemove: "mouse"
        },

        _EVT_TYPES: {
            touchstart: "start",
            touchcancel: "end",
            touchend: "end",
            touchmove: "move",
            mousedown: "start",
            mouseup: "end",
            mousemove: "move"
        },

        _onPointerStart: function (evt) {
            evt.preventDefault();
            if (!this._pointerType) {
                this._logger.timestamp('timestamps.controlStart');
                this._pointerType = this._EVT_MAP[evt.type];
                this._pointerId = this._pointerType == "touch" ? evt.originalEvent.changedTouches[0].identifier : null;
                this._logEvt(this._buildPEvent(evt));
            }
        },

        _onPointerEnd: function (evt) {
            var pointerEvent = this._buildPEvent(evt);
            evt.preventDefault();
            if (pointerEvent) {
                this._logger.timestamp('timestamps.executionEnd');
                this._logEvt(pointerEvent);
                this._resolve();
                this._techniqueDiv.off(this._handlers);
            }
        },

        _onPointerMove: function (evt) {
            var pevt = this._buildPEvent(evt),
                diffX, diffY;
            evt.preventDefault();
            if (pevt) {
                if (this._previousPointerPos) {
                    diffX = pevt.pos[0] - this._previousPointerPos[0];
                    diffY = pevt.pos[1] - this._previousPointerPos[1];
                    this._moveObject([diffX, diffY]);
                }
                this._previousPointerPos = pevt.pos;
                this._logEvt(pevt);
            }
        },


        _logEvt: function (evt) {
            this._logger.addEvent({
                pointer: {
                    x: evt.pos[0],
                    y: evt.pos[1],
                    type: evt.pointerType
                },
                eventType: evt.type,
                techniqueState: this._state,
                'timestamps.event': evt.timeStamp,
            });
        },

        _click: function (modeId, modeLabel, evt) {
            this._state = 'positionning';
            this._tracking = true;
            this._modeSelected(modeId);
            this._techniqueDiv.on(this._handlers);
            this._logger.set('toolbar.selectedButton', this._getButtonLogParams(modeLabel));
            this._logger.timestamp('timestamps.executionStart');
            this._logger.timestamp('timestamps.trigger');
            this._logger.timestamp('timestamps.selection');
            this._logEvt({
                pos: [evt.originalEvent.pageX, evt.originalEvent.pageY],
                pointerType: evt.originalEvent instanceof MouseEvent ? "mouse" : "touch",
                timeStamp: evt.timeStamp,
                type: evt.type
            });
        },

    });

});