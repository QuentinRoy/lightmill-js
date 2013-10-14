define(['fingermenu', './test-task', 'jquery'], function (FingerMenu, TestTask, $) {
    "use strict";


    return TestTask.$extend({

        __init__: function () {
            this.$super.apply(this, arguments);

            // initialize stuffs
            this._lastPos = null;
            this._targetFinger = null;
            this._targetLevel = null;

            // create the mappings
            this._fingerModes = this._createFingerModes();
            this._fingerLabels = this._createFingerLabels();
        },


        _initTechnique: function (techniqueDiv) {
            this._fingerMenu = new FingerMenu(this._fingerLabels, techniqueDiv, true, this._logger);

            // add the handlers
            this._fingerMenu.fingerTouched.add($.proxy(this._onFingerTouched, this));
            this._fingerMenu.fingerReleased.add($.proxy(this._onFingerReleased, this));
            this._fingerMenu.fingerMoved.add($.proxy(this._onFingerMoved, this));
        },

        _createFingerModes: function () {
            var modeId, mode, fingerName,
                modes = [],
                fingerNames = ['index', 'middle', 'ring', 'pinky'],
                lvl = 0,
                fNum = 0;
            for (modeId in this._modeMapping) {
                mode = this._modeMapping[modeId];
                fingerName = fingerNames[fNum];
                if (fNum === 0)
                    modes.push({});
                modes[lvl][fingerName] = mode;

                if (modeId === this._targetMode) {
                    this._targetFinger = fingerName;
                    this._targetLevel = lvl;
                }

                fNum++;
                if (fNum >= fingerNames.length) {
                    fNum = 0;
                    lvl++;
                }
            }
            return modes;
        },

        _taskParams: function () {
            var res = this.$super();
            res.technique = 'FingerMenu';
            res.finger = this._targetFinger;
            res.level = this._targetLevel;
            return res;
        },

        _createFingerLabels: function () {
            var labels = [];
            for (var levelNum in this._fingerModes) {
                var level = this._fingerModes[levelNum];
                var lvlLabels = {};
                labels.push(lvlLabels);
                for (var fingerName in level) {
                    var fingerMode = level[fingerName];
                    lvlLabels[fingerName] = fingerMode.name;
                }
            }
            return labels;
        },

        _onFingerTouched: function (finger) {
            var targetPosition = this._fingerMenu.fingerPosition(this._targetLevel, this._targetFinger);
            var selectedPosition = this._fingerMenu.fingerPosition(finger.level, finger.name);

            this._logger.set({
                fm: {
                    selectedFinger: {
                        name: finger.name,
                        level: finger.level,
                        x: selectedPosition[0],
                        y: selectedPosition[1]
                    },
                    targetFinger: {
                        name: this._targetFinger,
                        level: this._targetLevel,
                        x: targetPosition[0],
                        y: targetPosition[1]
                    }
                },
                triggerPos: {
                    x: finger.pos[0],
                    y: finger.pos[1]
                }
            });
            var modeId = this._fingerModes[finger.level][finger.name].id;
            this._modeSelected(modeId);
            this._lastPos = finger.pos;
        },

        _onFingerMoved: function (finger) {
            var dPos;
            if (this._lastPos) {
                dPos = [finger.pos[0] - this._lastPos[0], finger.pos[1] - this._lastPos[1]];
                this._moveObject(dPos);
            }
            this._lastPos = finger.pos;
        },

        _onFingerReleased: function (finger) {
            this._onFingerMoved(finger);
            this._resolve();
        },


    });

});