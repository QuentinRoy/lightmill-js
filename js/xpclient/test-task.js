/*jslint nomen: true, browser:true*/
/*global define */

define(['jquery', 'jstools/tools', 'jstools/geoTools', 'color'], function ($, tools, geoTools, Color) {

    function TestTask(parentDiv, params) {

        this.parentDiv = parentDiv;
        this.params = params;

        this._mainDiv = null;
        this._object = null;
        this._target = null;
        this._taskDeff = null;
        this._lastTaskDeff = null;
        this._startTime = null;

        this._isCloseEnough = false;
        this._closeEnoughTime = null;

        this.targetDist = params.target_dist || this.DEFAULT_TARGET_DIST;
        this.maxDist = params.max_dist || this.DEFAULT_MAX_DIST;
        this.minTime = params.min_time || this.DEFAULT_MIN_TIME;
    }

    TestTask.prototype = {

        DEFAULT_TARGET_DIST: 600,

        DEFAULT_MAX_DIST: 2,

        DEFAULT_MIN_TIME: 500,

        _createObject: function () {
            var objDiv = $("<div />"),
                size = 28;
            objDiv.css({
                position: 'absolute',
                width: size,
                height: size,
                "border-radius": size,
                "background-color": "#949494",
            });
            return objDiv;
        },

        _targetWrongCss: function () {
            var borderColor = this._modeMapping[this.params.values.mode],
                backgroundColor = Color(borderColor).alpha(0.2),
                size= 34;
            return {
                "border-color": borderColor,
                "background-color": backgroundColor.rgbString(),
                "border-width": 4,
                width: size,
                height: size,
                "border-radius": size,
            };
        },

        _targetGoodCss: function () {
            var backgroundColor = Color(this._modeMapping[this.params.values.mode]).alpha(0.5),
                size = 33;
            return {
                "background-color": backgroundColor.rgbString(),
                "border-width": 6,
                width: size,
                height: size,
                "border-radius": size,
            };
        },

        _setTargetSelected: function (selected) {
            this._target.css(selected ? this._targetGoodCss() : this._targetWrongCss());
            tools.centerOf(this._target, this._positions().target);
        },

        _createTarget: function () {
            var targetDiv = $("<div />"),
                size = 34;
            targetDiv.css(this._targetWrongCss());
            targetDiv.css({
                position: 'absolute',
                "border-style": "solid",
            });
            return targetDiv;
        },

        _createMainDiv: function () {
            return $('<div class="full-parent"></div>');
        },

        _modeMapping: {
            mode1: "#FF1A1C",
            mode2: "rgb(55, 126, 184)",
            mode3: "rgb(77, 175, 74)",
            mode4: "rgb(152, 78, 163)",
            mode5: "rgb(255, 127, 0)",
            mode6: "#E8DC00",
            mode7: "rgb(166, 86, 40)",
            mode8: "rgb(247, 129, 191)"
        },

        _directionMapping: {
            right: 0,
            left: Math.PI,
            bottom: Math.PI / 2,
            top: 3 * Math.PI / 2
        },

        _positions: function () {
            var dir = this.params.values.direction,
                center = tools.centerOf(this._mainDiv),
                centerDist = this.targetDist / 2,
                angleMapping = this._directionMapping[dir],
                targetAngle = tools.isUnset(angleMapping) ? dir : angleMapping,
                objectAngle = targetAngle + Math.PI;

            return {
                object: [center[0] + Math.cos(objectAngle) * centerDist, center[1] + Math.sin(objectAngle) * centerDist],
                target: [center[0] + Math.cos(targetAngle) * centerDist, center[1] + Math.sin(targetAngle) * centerDist]
            };
        },

        _closeEnough: function () {
            var objCenter = tools.centerOf(this._object),
                targetCenter = tools.centerOf(this._target),
                dist = geoTools.dist(objCenter, targetCenter);
            return dist < this.maxDist;
        },

        _updateCloseEnoughTimer: function () {
            var that = this,
                closeEnough = this._closeEnough();
            if (closeEnough && !this._isCloseEnough) {
                this._isCloseEnough = closeEnough;
                this._closeEnoughTime = setTimeout(function () {
                    that._resolve();
                }, this.minTime);
                this._setTargetSelected(true);
            } else if (!closeEnough && this._isCloseEnough) {
                this._isCloseEnough = closeEnough;
                this._setTargetSelected(false);
                clearTimeout(this._closeEnoughTime);
                this._closeEnoughTime = null;
            }
        },

        get started() {
            return this._taskDeff !== null;
        },

        get completed() {
            return this._taskDeff && this._taskDeff.state != 'pending ';
        },

        start: function (callback) {
            if (this._taskDeff) {
                throw "Task already started.";
            }
            this._taskDeff = $.Deferred();
            this._startTime = new Date().getTime();

            // create the target if needed
            this._mainDiv = this._createMainDiv();
            this._object = this._object || this._createObject();
            this._target = this._target || this._createTarget();

            this._mainDiv.appendTo(this.parentDiv);
            this._target.appendTo(this._mainDiv);
            this._object.appendTo(this._mainDiv);

            var positions = this._positions();
            tools.centerOf(this._object, positions.object);
            tools.centerOf(this._target, positions.target);


            var dragging = false,
                lastPosition = null,
                that = this;
            this._mainDiv.on({
                mousedown: function (evt) {
                    lastPosition = [evt.pageX, evt.pageY];
                    dragging = true;
                    evt.preventDefault();
                },
                mousemove: function (evt) {
                    if (dragging) {
                        var thisPosition = [evt.pageX, evt.pageY],
                            diff = [thisPosition[0] - lastPosition[0], thisPosition[1] - lastPosition[1]];
                        tools.move(that._object, diff);
                        that._updateCloseEnoughTimer();
                        lastPosition = thisPosition;
                        evt.preventDefault();
                    }
                },
                mouseup: function (evt) {
                    if (dragging) {
                        dragging = false;
                        evt.preventDefault();
                    }
                }
            });

            this._taskDeff.done(function () {
                that._mainDiv.remove();
                that._taskDeff = null;
            });
            this._taskDeff.done(callback);
            return this._taskDeff.promise();

        },

        _resolve: function () {
            var results = {
                duration: new Date().getTime() - this._startTime
            };
            this._taskDeff.resolveWith(this, [results]);
        },

    };

    return TestTask;

});