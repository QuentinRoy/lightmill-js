define(

['jquery', 'jstools/tools', 'jstools/geoTools', 'color', 'sigmamenu', './trial-logger', 'classy', './nomode-processors', '../views/trial-init'],

function ($, tools, geoTools, Color, SigmaMenu, TrialLogger, Class, processors, TrialInitView) {
    "use strict";


    var TestTask = Class.$extend({
        __init__: function (parentDiv, params) {

            this.parentDiv = parentDiv;
            this.params = params;

            this._mainDiv = null;
            this._object = null;
            this._target = null;
            this._taskDeff = null;
            this._lastTaskDeff = null;
            this._techniqueDiv = null;
            this._objectsDiv = null;
            this._objectMode = null;
            this._targetReached = false;
            this._targetMode = params.values.mode || params.block_values.mode;

            this._trialInitView = null;

            this.targetDist = params.target_dist || this.DEFAULT_TARGET_DIST;
            this.maxDist = params.max_dist || this.DEFAULT_MAX_DIST;
            this.minTime = params.min_time || this.DEFAULT_MIN_TIME;

            this._logger = new TrialLogger(params, processors.all());

            this._logger.beforeEvent = $.proxy(function (evt) {
                return this._beforeLoggerEvent(evt);
            }, this);


            this._initPositions = this._positions();
        },

        DEFAULT_TARGET_DIST: 400,

        DEFAULT_MAX_DIST: 4,

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
                size = 34;
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
                size = 31;
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
                this._object.css("background-color", this._modeMapping[this._objectMode].color);
            } else {
                this._object.css("background-color", "black");
            }
        },


        _taskParams: function () {
            return {
                technique: this.params.block_values.technique || this.params.values.technique,
                positions: this._initPositions
            };

        },

        _modeSelected: function (modeId) {
            var oldMode = this._objectMode;
            this._objectMode = modeId ? modeId : oldMode;
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
                center = tools.centerOf(this.parentDiv),
                centerDist = this.targetDist / 2,
                angleMapping = this._directionMapping[dir],
                targetAngle = tools.isUnset(angleMapping) ? dir : angleMapping,
                objectAngle = targetAngle + Math.PI;

            return {
                object: [center[0] + Math.cos(objectAngle) * centerDist, center[1] + Math.sin(objectAngle) * centerDist],
                target: [center[0] + Math.cos(targetAngle) * centerDist, center[1] + Math.sin(targetAngle) * centerDist]
            };
        },

        _distanceFromTarget: function () {
            var objCenter = tools.centerOf(this._object),
                targetCenter = tools.centerOf(this._target);
            return geoTools.dist(objCenter, targetCenter);
        },

        _closeEnough: function () {
            return this._distanceFromTarget() < this.maxDist;
        },

        _updateTargetReached: function () {
            var targetReached = this._closeEnough() && !tools.isUnset(this._objectMode);
            if (targetReached && !this._targetReached) {
                this._targetReached = targetReached;
                this._setTargetSelected(true);
            } else if (!targetReached && this._targetReached) {
                this._targetReached = targetReached;
                this._setTargetSelected(false);
            }
        },

        get started() {
            return Boolean(this._taskDeff);
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
            tools.centerOf(this._object, this._initPositions.object);
            tools.centerOf(this._target, this._initPositions.target);
        },

        start: function (callback) {
            var that = this;
            if (this._taskDeff) {
                throw "Task already started.";
            }
            this._taskDeff = $.Deferred();

            this._logger.timestamp('timestamps.preTrialStart');

            var params = this._taskParams();
            $.extend(params, this.params);
            
            this._trialInitView = new TrialInitView(params, this.parentDiv);
            this._trialInitView.open().done(function () {
                that._startTrial();
            });

            this._taskDeff.done(function () {
                that._mainDiv.remove();
                that._taskDeff = null;
            });
            this._taskDeff.done(callback);
            return this._taskDeff.promise();
        },

        _startTrial: function () {
            this._logger.timestamp('timestamps.trialStart');

            this._createDOM();


            this._initTechnique(this._techniqueDiv);
        },

        _beforeLoggerEvent: function (event) {
            var objectPos = tools.centerOf(this._object);
            event.objectInitialPos = {
                x: this._initPositions.object[0],
                y: this._initPositions.object[1]
            };
            event.distFromTarget = this._distanceFromTarget();
            event.objectPos = {
                x: objectPos[0],
                y: objectPos[1]
            };
            event.selectedMode = this._objectMode;
            event.targetPos = {
                x: this._initPositions.target[0],
                y: this._initPositions.target[1]
            };

            event.targetReached = this._closeEnough();
            return event;
        },

        _moveObject: function (dx, dy) {
            tools.move(this._object, dx, dy);
            this._updateTargetReached();
        },

        _resolve: function (synchrone) {
            var _this = this;
            if (synchrone)
                this._instantResolve();
            else
                setTimeout(function () {
                    _this._instantResolve();
                }, 0);
        },

        _instantResolve: function () {
            this._logger.timestamp('timestamps.trialEnd');
            var objectFinalPos = tools.centerOf(this._object);
            this._logger.set({
                selectedMode: this._objectMode,
                selectedModeLabel: this._modeMapping[this._objectMode].name,
                targetModeLabel: this._modeMapping[this._targetMode].name,
                distFromTarget: this._distanceFromTarget(),
                targetReached: this._closeEnough(),
                targetPos: {
                    x: this._initPositions.target[0],
                    y: this._initPositions.target[1]
                },
                objectInitialPos: {
                    x: this._initPositions.object[0],
                    y: this._initPositions.object[1]
                },
                'objectFinalPos.x': objectFinalPos[0],
                'objectFinalPos.y': objectFinalPos[1],
                distToReach: this.maxDist
            });
            var log = this._logger.getLog();
            this._taskDeff.resolveWith(this, [log]);
        },

        _modeMapping: {
            mode1: {
                color: "#FF1A1C",
                name: "Red",
                id: 'mode1'
            },
            mode2: {
                color: "rgb(55, 126, 184)",
                name: "Blue",
                id: 'mode2'
            },
            mode3: {
                color: "rgb(77, 175, 74)",
                name: "Green",
                id: 'mode3'
            },
            mode4: {
                color: "#E8DC00",
                name: "Yellow",
                id: 'mode4'
            },
            mode5: {
                color: "rgb(255, 127, 0)",
                name: "Orange",
                id: 'mode5'
            },
            mode6: {
                color: "rgb(152, 78, 163)",
                name: "Purple",
                id: 'mode6'
            },
            mode7: {
                color: "rgb(166, 86, 40)",
                name: "Brown",
                id: 'mode7'
            },
            mode8: {
                color: "#F7C8E9",
                name: "Pink",
                id: 'mode8'
            }
        },

    });

    return TestTask;


});