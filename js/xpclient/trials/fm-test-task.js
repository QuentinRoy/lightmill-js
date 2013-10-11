define(['fingermenu', './test-task', 'jquery'], function (FingerMenu, TestTask, $) {
    "use strict";


    return TestTask.$extend({

        _initTechnique: function (techniqueDiv) {

            // create the mappings
            this._fingerModes = this._createFingerModes();
            this._fingerLabels = this._createFingerLabels();

            // create the menu
            this._fingerMenu = new FingerMenu(this._fingerLabels, techniqueDiv, true);

            // add the handlers
            this._fingerMenu.fingerTouched.add($.proxy(this._onFingerTouched, this));
            this._fingerMenu.fingerReleased.add($.proxy(this._onFingerReleased, this));
            this._fingerMenu.fingerMoved.add($.proxy(this._onFingerMoved, this));

            // initialize stuffs
            this._lastPos = null;
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
                fNum++;
                if (fNum >= fingerNames.length) {
                    fNum = 0;
                    lvl++;
                }
            }
            return modes;
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
            var modeId = this._fingerModes[finger.level][finger.name].id;
            this._modeSelected(modeId);
            this._lastPos = finger.pos;
        },

        _onFingerMoved: function (finger) {
            console.log("moved");
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