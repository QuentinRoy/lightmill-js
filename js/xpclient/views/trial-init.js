define(

['jquery', 'handlebars', 'image!js/xpclient/views/hand.svg', 'image!js/xpclient/views/sigmamenu.svg', 'image!js/xpclient/views/arrow.svg', 'text!./trial-init-template.html',
    'jstools/tools', 'css!./trial-init.css'],

function ($, Handlebars, handImage, smImage, arrowImage, template, tools) {
    "use strict";

    function TrialInitView(trialParams, parentView) {
        this._parentView = $(parentView);
        this._div = null;
        this._template = Handlebars.compile(template);

        this._params = trialParams;

        this._technique = this._params.technique;

    }

    TrialInitView.prototype = {


        _imageMap: {
            SigmaMenu: smImage,
            Toolbar: arrowImage,
            FingerMenu: handImage
        },

        open: function () {
            var compiledTemplate = this._template({
                name: this._params.practice ? "Practice" : "Block " + (this._params.measure_block_number + 1),
                values: this._params.block_values
            }),
                that;

            this._dfd = $.Deferred();

            this._div = $(compiledTemplate);
            this._parentView.append(this._div);

            this._displayImage();

            return this._dfd.done(function () {
                that._div.remove();
            });
        },

        _displayImage: function () {
            this._image = $(this._imageMap[this._technique]);
            this._imageDiv = $('<div id="init-trial-img-div"></div>');
            this._div.append(this._imageDiv);
            this._imageDiv.append(this._image);
            tools.centerOf(this._imageDiv, this._div.width() / 2, this._div.height() / 2);

            if (this._technique == 'FingerMenu') {
                this._fmFingerOverlay();
            }
        },


        _createFingerModes: function () {
            var modeId, mode, fingerName,
                // FIXME: ugly
                modes = ['mode1', 'mode2', 'mode3', 'mode4', 'mode5', 'mode6', 'mode7', 'mode8'],
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

        _fmFingerOverlay: function () {
            var overlaySize = 30,
                overlay = $('<div class="fm-overlay"></div>');
            overlay.css({
                width: overlaySize,
                height: overlaySize,
                'border-radius': overlaySize
            });
            overlay.attr({
                finger: this._params.finger,
                level: this._params.level
            });
            this._imageDiv.append(overlay);
        }
    };

    return TrialInitView;

});