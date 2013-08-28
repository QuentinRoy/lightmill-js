define(['./xp-connect', 'jquery', 'state-machine', 'jstools/tools'], function (xpconnect, $, StateMachine, tools) {
    "use strict";

    function PreTestManager(taskManager, mainDiv) {
        this._mainDiv = mainDiv || $("#main-div");
        this._taskManager = taskManager;
        this._trialResultPromise = null;

        // TODO: something instead of nothing
        this._loadingWidget = {
            start: function () {},
            stop: function () {}
        };

        this._fsm = StateMachine.create({
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

        start: function () {
            this._fsm.start();
        },
        
        _onInterTrial: function (name, from, to) {
            this._loadingWidget.start();
            xpconnect.requestNextTrial()
                .done($.proxy(this._fsm.trialinfo, this._fsm))
                .fail(function (m) {
                    alert("Couldn't retrieve trial info:" + m);
                });
        },
                
        _ontrialrunning: function(name, from, to, trialinfo){
            this._taskManager.startTask(trialinfo).done($.proxy(this._fsm.trialend, this._fsm));
        },
        
        _onleavetrialrunning: function(name, from, to, trialresult){
            xpconnect.postTrialResults(trialresult);
        },

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