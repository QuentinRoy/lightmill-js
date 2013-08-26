define(['./xpconnect', 'jquery', 'state-machine'], function (xpconnect, $, StateMachine) {
    "use strict";

    function PreTestManager(mainDiv) {
        this._mainDiv = mainDiv || $("#main-div");

        // TODO: something instead of nothing
        this._loadingWidget = {
            start: function () {},
            stop: function () {}
        };

        this._stateMachine = StateMachine.create({
            initial: 'idle',
            events: [
                { name: 'start',        from: 'idle',           to: 'intertrial'    },
                { name: 'trialinfo',    from: 'intertrial',     to: 'trialrunning'  },
                { name: 'trialend',     from: 'trialrunning',   to: 'intertrial'    },
                { name: 'blockend',     from: 'trialrunning',   to: 'interblock'    },
                { name: 'startelock',   from: 'interblock',     to: 'intertrial'    },
                { name: 'xpend',        from: 'trialrunning',   to: 'completed'     }
            ],
            callbacks: this._getFsmCallbacks()
        });
    }

    PreTestManager.prototype = {

        createObject: function () {
            var objDiv = $("<div />"),
                size = 150;
            objDiv.css({
                width: size,
                height: size,
                "border-radius": size,
                "background-color": "#3231FF",
                "background-opacity": 0.7,
                "border-style": "solid",
                "border-width": 3,
                "border-color": "#494995"
            });
            return objDiv;
        },

        createTarget: function () {
            var targetDiv = $("<div />"),
                size = 160;
            targetDiv.css({
                width: size,
                height: size,
                "border-radius": size,
                "border-style": "solid",
                "border-width": 3,
                "border-color": "#4D954D"
            });
        },

        start: function () {
            this._fsm.start();
        },

        _onInterTrial: function () {
            this._loadingWidget.start();
            xpconnect.requestNextTrial().done($.proxy(this._startTrial, this));
        },

        _startTrial: function () {},


        _getFsmCallbacks: function () {
            var callbacks = {};
            for (var prop in this) {
                if (prop.startsWith("_on")) {
                    var fsmStr = prop.toLowerCase().slice(1),
                        method = this[prop];
                    if (typeof method === "function"){
                        callbacks[fsmStr] = $.proxy(this[prop], this);
                    }
                }
            }
            return callbacks;
        },


    };

    return PreTestManager;

});