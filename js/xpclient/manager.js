/*jslint nomen: true, browser:true*/
/*global define */

define(['./connection', './inter-views', 'jquery', 'state-machine', 'jstools/tools', './config'],
       function (XpConnection, InterManager, $, StateMachine, tools, config) {
    "use strict";

    function PreTestManager(taskManager, mainDiv) {
        this._mainDiv = mainDiv || $("#main-div");
        this._taskManager = taskManager;
        this._trialResultPromise = null;
        this._currentTrial = null;
        this._interManager = new InterManager();
        this._connection = new XpConnection();

        this._fsm = StateMachine.create({
            initial: 'idle',
            events: [
                { name: 'start',        from: 'idle',           to: 'blockloading'  },
                { name: 'trialloaded',  from: 'trialloading',   to: 'trialrunning'  },
                { name: 'trialend',     from: 'trialrunning',   to: 'trialloading'  },
                { name: 'blockend',     from: 'trialrunning',   to: 'blockloading'  },
                { name: 'blockloaded',  from: 'blockloading',   to: 'blockinit'     },
                { name: 'startblock',   from: 'blockinit',      to: 'trialloading'  },
                { name: 'xpend',        from: 'trialrunning',   to: 'completed'     }
            ],
            callbacks: this._getFsmCallbacks()
        });
    }

    PreTestManager.prototype = {

        start: function () {
            this._fsm.start();
        },
        
        _onBlockLoading: function(){
            var that = this;
            this._connection.currentTrial.done(function(trial){
                that._fsm.blockloaded({
                    number:trial.block_number,
                    values:trial.block_values,
                    measure_block_number:trial.measure_block_number
                });
            });
        },
        
        _onBlockInit: function(name, from, to, blockInfo){
            this._interManager.blockInit(blockInfo).done($.proxy(this._fsm.startblock, this._fsm));
        },
        
        _onTrialLoading: function () {
            this._interManager.startWaiting();
            this._connection.currentTrial
                .done($.proxy(this._fsm.trialloaded, this._fsm))
                .fail(function (m) {
                    if(m && m.responseJSON && m.responseJSON.message){
                        alert("Couldn't retrieve trial info: " +  m.responseJSON.message);
                    } else if(m && m.statusText) {
                        alert("Couldn't retrieve trial info: " +  m.statusText);
                    } else {
                        alert("Couldn't retrieve trial info");
                    }
                });
        },
        
        _onLeavetrialloading: function(){
            this._interManager.stopWaiting();
        },
                
        _onTrialRunning: function (name, from, to, trial) {
            var that = this;
            this._currentTrial = trial;
            this._taskManager.startTask(trial).done(function (results) {
                if(trial.number < trial.total -1 ){
                    that._fsm.trialend(results);
                } else {
                    that._fsm.blockend(results);
                }
            });
        },
        
        _onLeaveTrialRunning: function(name, from, to, trialresult){
            this._connection.sendTrialResults(trialresult);
        },
        
        _onBeforeEvent: function(name, from, to){
            if(config.DEBUG.managerfsm){
                console.log('MANAGER FSM: '+name+': '+from+' -> '+to);
            }
        },

        _getFsmCallbacks: function () {
            var callbacks = {};
            for (var prop in this) {
                if (prop.startsWith("_on")) {
                    var fsmProm = prop.toLowerCase().slice(1),
                        method = this[prop];
                    if (typeof method === "function"){
                        callbacks[fsmProm] = $.proxy(this[prop], this);
                    }
                }
            }
            return callbacks;
        },


    };

    return PreTestManager;

});