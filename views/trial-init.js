define(

['jquery', 'handlebars', 'image!images/handi0.svg', 'image!images/handi1.svg', 'image!images/handm0.svg', 'image!images/handm1.svg', 'image!images/handr0.svg', 'image!images/handr1.svg', 'image!images/handp0.svg', 'image!images/handp1.svg', 'image!images/sigmamenu.svg', 'image!images/arrow.svg', 'text!./trial-init-template.html', 'jstools/tools', 'fastclick', 'css!./trial-init.css', 'css!./main.css'],

function ($, Handlebars, handI0, handI1, handM0, handM1, handR0, handR1, handP0, handP1, smImage, arrowImage, template, tools, FastClick) {
    "use strict";

    function TrialInitView(trialParams, parentView) {
        this._parentView = $(parentView);
        this._div = null;
        this._template = Handlebars.compile(template);

        this._params = trialParams;

        this._technique = this._params.technique;
        this.delay = this.DELAY;

    }

    TrialInitView.prototype = {

        DELAY: 500,

        _imageMap: {
            SigmaMenu: smImage,
            Toolbar: arrowImage,
            FingerMenu: [
                {
                    index: handI0,
                    middle: handM0,
                    ring: handR0,
                    pinky: handP0
                }, {
                    index: handI1,
                    middle: handM1,
                    ring: handR1,
                    pinky: handP1
                }
            ]
        },

        open: function () {
            var compiledTemplate = this._template({
                name: this._params.practice ? "Practice" : "Block " + (this._params.measure_block_number + 1),
                values: this._params.block_values
            }),
                that = this;

            this._dfd = $.Deferred();
            this._div = $(compiledTemplate);
            this._startButton = this._div.find('.start-button');
            FastClick.attach(this._div[0]);

            this._parentView.append(this._div);

            this._displayImage();
            this._dealWithButton();

            return this._dfd.done(function () {
                that._div.remove();
            });
        },


        _dealWithButton: function () {
            var that = this;
            
            tools.centerOf(this._startButton, this._params.positions.object);
            this._startButton.css({
                opacity: '0'
            });
            setTimeout(function () {
                that._startButton.animate({
                    opacity: 1
                }, 'fast');
                that._startButton.click(function () {
                    setTimeout(function () {
                        that._dfd.resolve();
                    }, 0);
                });
            }, that.delay);
        },


        _displayImage: function () {
            var buttonHeight = this._startButton.outerHeight(),
                imageHeight;
            this._imageDiv = $('<div id="init-trial-img-div"></div>');
            this._div.append(this._imageDiv);

            if (this._technique == 'FingerMenu') {
                this._image = $(this._imageMap[this._technique][this._params.level][this._params.finger]);
                this._imageDiv.append(this._image);
                this._imageDiv.addClass('fm-img');
                var divWidth = this._div.width(),
                    divHeight = this._div.height();
                imageHeight = this._imageDiv.outerHeight();
                tools.centerOf(this._imageDiv, divWidth / 2, divHeight / 2 - buttonHeight / 2 - imageHeight / 2);
            } else if (this._technique == 'SigmaMenu') {
                console.log('rotation: ' + this._params.rotation);
                console.log('direction: ' + this._params.direction);

                this._image = $(this._imageMap[this._technique]);
                this._imageDiv.append(this._image);
                this._imageDiv.attr({
                    rotation: this._params.rotation,
                    direction: this._params.direction
                });
                this._imageDiv.addClass('sm-img');
                imageHeight = this._imageDiv.outerHeight();
                tools.centerOf(this._imageDiv, this._div.width() / 2, this._div.height() / 2 - buttonHeight / 2 - imageHeight / 2);
            } else if (this._technique == 'Toolbar') {
                this._image = $(this._imageMap[this._technique]);
                this._imageDiv.append(this._image);
                this._imageDiv.addClass('tb-img');
                tools.centerOf(this._imageDiv, this._params.targetCenter[0], this._params.targetCenter[1] - this._imageDiv.outerHeight() / 2 - 10);
            }
        },


    };

    return TrialInitView;

});