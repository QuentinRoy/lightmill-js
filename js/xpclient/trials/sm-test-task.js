define(['jstools/tools', './test-task', 'sigmamenu'], function (tools, TestTask, SigmaMenu) {
    "use strict";


    return TestTask.$extend({


        __init__: function (mainDiv, params) {
            this.$super(mainDiv, params);
            this._technique = null;
            this._results = {
                events: []
            };

            var modes = [];
            for (var modeId in this._modeMapping) {
                var mode = this._modeMapping[modeId];
                modes.push({
                    name: mode.name,
                    id: modeId
                });
            }
            modes.sort(function (a, b) {
                b = [a.id, b.id];
                b.sort();
                return b[0] === a.id ? -1 : 0;
            });

            this._smModes = {
                pos: {
                    left: modes.pop(),
                    right: modes.pop(),
                    bottom: modes.pop(),
                    top: modes.pop(),
                },
                neg: {
                    left: modes.pop(),
                    right: modes.pop(),
                    bottom: modes.pop(),
                    top: modes.pop(),
                }
            };
        },

        _getModeParams: function (modeId) {
            var pos, dir, modes, mode;
            for (pos in this._smModes) {
                modes = this._smModes[pos];
                for (dir in modes) {
                    mode = modes[dir];
                    if (mode.id === modeId) {
                        return {
                            direction: dir,
                            rotation: pos
                        };
                    }
                }
            }
        },

        _convertDir: function (dir) {
            switch (dir) {
            case 'right':
                return 0;
            case 'bottom':
                return 90;
            case 'left':
                return 180;
            case 'top':
                return 225;
            default:
                throw 'unknown direction';
            }
        },

        _convertRot: function (rot) {
            switch (rot) {
            case 'pos':
                return 1;
            case 'neg':
                return -1;
            case 'neutral':
                return 0;
            default:
                throw 'unknown rotation';
            }
        },

        _initTechnique: function (techniqueDiv) {
            var labels = {
                pos: {},
                neg: {}
            }, dir, sign;
            for (sign in this._smModes) {
                for (dir in this._smModes[sign]) {
                    labels[sign][dir] = this._smModes[sign][dir].name;
                }
            }

            this._technique = new SigmaMenu(techniqueDiv, labels, this._logger);
            this._technique.moved.add(this._smMove, this);
            this._technique.activated.add(this._smActivated, this);
            this._technique.ended.add(this._smEnded, this);
            this._technique.start();
        },


        _smActivated: function (params) {
            var mode = this._smModes[params.rotation][params.direction].id;
            this._modeSelected(mode);
        },

        _smEnded: function () {
            var modeParam = this._getModeParams(this._targetMode);
            this._logger.set({
                sm: {
                    targetRotation: this._convertRot(modeParam.rotation),
                    targetDirection: this._convertDir(modeParam.direction)
                }
            });

            this._resolve();
        },

        _smMove: function (params) {
            this._moveObject(params.dpos);
        },
    });



});