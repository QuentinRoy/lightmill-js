/*jslint nomen: true, browser:true*/
/*global define */

define(['jquery', 'jstools/tools', 'jstools/geoTools', 'color', 'sigmamenu', 'classy'], function ($, tools, geoTools, Color, SigmaMenu, Class) {


    var TestTask = Class.$extend({
        __init__: function (parentDiv, params) {

            this.parentDiv = parentDiv;
            this.params = params;

            this._mainDiv = null;
            this._object = null;
            this._target = null;
            this._taskDeff = null;
            this._lastTaskDeff = null;
            this._startTime = null;
            this._techniqueDiv = null;
            this._objectsDiv = null;

            this._objectMode = null;

            this._targetReached = false;
            this._closeEnoughTime = null;

            this.targetDist = params.target_dist || this.DEFAULT_TARGET_DIST;
            this.maxDist = params.max_dist || this.DEFAULT_MAX_DIST;
            this.minTime = params.min_time || this.DEFAULT_MIN_TIME;


            this._smLabels = null;

            this._technique = null;
        },

        DEFAULT_TARGET_DIST: 400,

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
                "background-color": "black",
                "pointer-events": "none"
            });
            return objDiv;
        },

        _targetWrongCss: function () {
            var borderColor = this._modeMapping[this.params.values.mode].color,
                backgroundColor = Color(borderColor).alpha(0.1),
                size = 42;
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
            var baseColor = this._modeMapping[this.params.values.mode].color,
                backgroundColor = Color(baseColor).alpha(0.3),
                size = 41;
            return {
                "background-color": backgroundColor.rgbString(),
                "border-width": 6,
                width: size,
                height: size,
                "border-radius": size
            };
        },


        _upateObjectColor: function () {
            if (this._objectMode) {
                this._object.css("background-color", this._objectMode.color);
            } else {
                this._object.css("background-color", "black");
            }
        },

        _setObjectMode: function (modeId) {
            var oldMode = this._objectMode;
            this._objectMode = this._modeMapping[modeId];
            if (oldMode != this._objectMode) {
                this._upateObjectColor();
                this._updateTargetReached();
            }
            return this._objectMode;
        },

        _setTargetSelected: function (selected) {
            this._target.css(selected ? this._targetGoodCss() : this._targetWrongCss());
            tools.centerOf(this._target, this._positions().target);
        },

        _createTarget: function () {
            var targetDiv = $("<div />");
            targetDiv.css(this._targetWrongCss());
            targetDiv.css({
                position: 'absolute',
                "border-style": "solid",
                "pointer-events": "none"
            });
            return targetDiv;
        },

        _createFullDiv: function () {
            return $('<div class="full-parent"></div>');
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

        _updateTargetReached: function () {
            var that = this,
                targetReached = this._closeEnough() && !tools.isUnset(this._objectMode);
            if (targetReached && !this._targetReached) {
                this._targetReached = targetReached;
                this._closeEnoughTime = setTimeout(function () {
                    that._resolve();
                }, this.minTime);
                this._setTargetSelected(true);
            } else if (!targetReached && this._targetReached) {
                this._targetReached = targetReached;
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


        _createDOM: function () {
            this._mainDiv = this._createFullDiv();
            this._object = this._object || this._createObject();
            this._target = this._target || this._createTarget();

            this._mainDiv.appendTo(this.parentDiv);
            this._objectsDiv = this._createFullDiv();
            this._objectsDiv.css("pointer-events", "none");
            this._target.appendTo(this._objectsDiv);
            this._object.appendTo(this._objectsDiv);
            this._objectsDiv.appendTo(this._mainDiv);
            this._techniqueDiv = this._createFullDiv();
            this._techniqueDiv.appendTo(this._mainDiv);

            var positions = this._positions();
            tools.centerOf(this._object, positions.object);
            tools.centerOf(this._target, positions.target);
        },

        start: function (callback) {
            var that = this;
            if (this._taskDeff) {
                throw "Task already started.";
            }
            this._taskDeff = $.Deferred();
            this._startTime = new Date().getTime();

            this._createDOM();


            this._initTechnique(this._techniqueDiv);

            this._taskDeff.done(function () {
                that._mainDiv.remove();
                that._taskDeff = null;
            });
            this._taskDeff.done(callback);
            return this._taskDeff.promise();
        },

        _moveObject: function (dx, dy) {
            tools.move(this._object, dx, dy);
            this._updateTargetReached();
        },

        _resolve: function () {
            var results = {
                duration: new Date().getTime() - this._startTime,
                selectedMode: this._objectMode
            };
            this._taskDeff.resolveWith(this, [results]);
        },

        _modeMapping: {
            mode1: {
                color: "#FF1A1C",
                name: "Red"
            },
            mode2: {
                color: "rgb(55, 126, 184)",
                name: "Blue"
            },
            mode3: {
                color: "rgb(77, 175, 74)",
                name: "Green"
            },
            mode4: {
                color: "rgb(255, 127, 0)",
                name: "Orange"
            },
            mode5: {
                color: "rgb(152, 78, 163)",
                name: "Purple"
            },
            mode6: {
                color: "#E8DC00",
                name: "Yellow"
            },
            mode7: {
                color: "rgb(166, 86, 40)",
                name: "Brown"
            },
            mode8: {
                color: "#F7C8E9",
                name: "Pink"
            }
        },

    });

    return TestTask;

});