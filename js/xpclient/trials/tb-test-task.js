/*jslint nomen: true, browser:true*/
/*global define */

define(['jstools/tools', './test-task', 'toolbar', 'jquery'], function (tools, TestTask, Toolbar, $) {
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

            this._handlers = {
                "mousedown touchstart": $.proxy(this._onPointerStart, this),
                "mousemove touchmove": $.proxy(this._onPointerMove, this),
                "mouseup touchend touchcancel": $.proxy(this._onPointerEnd, this)
            };
        },

        get tracking() {
            return this._tracking;
        },

        _initTechnique: function (techniqueDiv) {
            this._toolbar = new Toolbar(techniqueDiv, this._callbacks, {
                buttonWidth: 80,
                spread: true
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
            return function () {
                if (!that.tracking) that._startTracking(modeId);
            };
        },

        _eventPos: function (evt) {
            var type = this._EVT_MAP[evt.type],
                touchNum, touch;
            if (type === this._pointerType) {
                if (type === 'touch') {
                    // find the touch
                    for (touchNum in evt.originalEvent.changedTouches) {
                        touch = evt.originalEvent.changedTouches[touchNum];
                        if (touch.identifier === this._pointerId) {
                            return [touch.pageX, touch.pageY];
                        }
                    }
                } else {
                    return [evt.originalEvent.pageX, evt.originalEvent.pageY];
                }
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

        _onPointerStart: function (evt) {
            console.log('pointer start');
            if (!this._pointerType) {
                this._pointerType = this._EVT_MAP[evt.type];
                this._pointerId = this._pointerType == "touch" ? evt.originalEvent.changedTouches[0] : null;
            }
        },

        _onPointerEnd: function (evt) {
            if (this._eventPos(evt)) {
                console.log('pointer end');
                this._resolve();
                this._techniqueDiv.off(this._handlers);
            }
        },

        _onPointerMove: function (evt) {
            var pos = this._eventPos(evt),
                diffX, diffY;
            if (pos) {
                console.log('pointer move');
                if (this._previousPointerPos) {
                    diffX = pos[0] - this._previousPointerPos[0];
                    diffY = pos[1] - this._previousPointerPos[1];
                    this._moveObject([diffX, diffY]);
                }
                this._previousPointerPos = pos;
            }
        },

        _startTracking: function (modeId) {
            this._tracking = true;
            this._modeSelected(modeId);
            this._techniqueDiv.on(this._handlers);
        },

    });

});