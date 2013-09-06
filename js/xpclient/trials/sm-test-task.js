/*jslint nomen: true, browser:true*/
/*global define */

define(['jstools/tools', './test-task', 'sigmamenu', 'jquery'], function (tools, TestTask, SigmaMenu, $) {


    return TestTask.$extend({


        __init__: function (mainDiv, params) {
            this.$super(mainDiv, params);
            this._technique = null;

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

            this._technique = new SigmaMenu(techniqueDiv, labels);
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
            this._resolve();
        },

        _smMove: function (params) {
            this._moveObject(params.dpos);
        },
    });



});