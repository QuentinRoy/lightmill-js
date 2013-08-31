/*jslint nomen: true, browser:true*/
/*global define */

define(['jquery', 'jstools/tools', 'jstools/geoTools'], function ($, tools, geoTools) {

    function TestTask(parentDiv, params) {

        this.parentDiv = parentDiv;
        this.params = params;

        this._mainDiv = null;
        this._object = null;
        this._target = null;
        this._taskDeff = null;
        this._lastTaskDeff = null;
        this._closeEnoughTime = null;
        this._startTime = null;

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
                "background-color": "#25A0DD",
            });
            return objDiv;
        },

        _targetWrongCss: {
            "border-color": "rgb(108, 207, 255)",
            "background-color": "rgba(108, 207, 255, 0.1)",
            "border-width": 2
        },

        _targetGoodCss: {
            // "border-color": "25A0DD",
            "background-color": "rgba(108, 207, 255, 0.2)",
            "border-width": 4
        },

        _setTargetSelected: function (selected) {
            this._target.css(selected ? this._targetGoodCss : this._targetWrongCss);
            tools.centerOf(this._target, this._positions().target);
        },

        _createTarget: function () {
            var targetDiv = $("<div />"),
                size = 34;
            targetDiv.css(this._targetWrongCss);
            targetDiv.css({
                position: 'absolute',
                width: size,
                height: size,
                "border-radius": size,
                "border-style": "solid",
            });
            return targetDiv;
        },

        _createMainDiv: function () {
            return $('<div class="full-parent"></div>');
        },


        _positions: function () {
            var dir = this.params.values.direction,
                center = tools.centerOf(this._mainDiv),
                centerDist = this.targetDist / 2;
            if (dir == "right") {
                return {
                    object: [center[0] - centerDist, center[1]],
                    target: [center[0] + centerDist, center[1]]
                };
            } else if (dir == "left") {
                return {
                    object: [center[0] + centerDist, center[1]],
                    target: [center[0] - centerDist, center[1]]
                };
            } else if (dir == "top") {
                return {
                    object: [center[0], center[1] + centerDist],
                    target: [center[0], center[1] - centerDist]
                };
            } else if (dir == "bottom") {
                return {
                    object: [center[0], center[1] - centerDist],
                    target: [center[0], center[1] + centerDist]
                };
            }
        },


        _closeEnough: function () {
            var objCenter = tools.centerOf(this._object),
                targetCenter = tools.centerOf(this._target),
                dist = geoTools.dist(objCenter, targetCenter);
            console.log('dist: ' + dist);
            return dist < this.maxDist;
        },


        _updateCloseEnoughTimer: function () {
            var that = this;
            if (that._closeEnough()) {
                if (!that._closeEnoughTime) {
                    that._closeEnoughTime = setTimeout(function () {
                        that._resolve();
                    }, that.minTime);
                    that._setTargetSelected(true);
                }
            } else {
                if (that._closeEnoughTime) {
                    that._setTargetSelected(false);
                    clearTimeout(this._closeEnoughTime);
                    that._closeEnoughTime = null;
                }
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