/*jslint nomen: true, browser:true*/
/*global define */

define(['./connection', './views/block-init', './views/wait', 'jquery', 'state-machine', 'jstools/tools', './config'],
       function (XpConnection, BlockInitView, WaitView, $, StateMachine, tools, config) {
    "use strict";

    function PreTestManager(taskManager, mainDiv) {
        this._mainDiv = mainDiv || $("#main-div");
        this._taskManager = taskManager;
        this._trialResultPromise = null;
        this._currentTrial = null;
        this._blockInitView = new BlockInitView(this._mainDiv);
        this._waitView = new WaitView(this._mainDiv);
        this._connection = new XpConnection();

        this._fsm = StateMachine.create({
            initial: 'idle',
            events: [
                { name: 'start',        from: 'idle',           to: 'runloading'     },
                { name: 'runloaded',    from: 'runloading',     to: 'blockloading'  },
                { name: 'blockloaded',  from: 'blockloading',   to: 'blockinit'     },
                { name: 'trialloaded',  from: 'trialloading',   to: 'trialrunning'  },
                { name: 'trialend',     from: 'trialrunning',   to: 'trialloading'  },
                { name: 'blockend',     from: 'trialrunning',   to: 'blockloading'  },
                { name: 'startblock',   from: 'blockinit',      to: 'trialloading'  },
                { name: 'xpend',        from: 'trialrunning',   to: 'completed'     },
                { name: 'connecterror',        from: '*',              to: 'crashed'       }
            ],
            callbacks: this._getFsmCallbacks()
        });
    }

    PreTestManager.prototype = {

        start: function () {
            this._fsm.start();
        },
        
        _populateFactorValues: function (values, factors) {
            var factorValues = {};
            for (var factorId in values) {
                var valueId = values[factorId],
                    valueName = factors[factorId].values[valueId] || valueId,
                    factorName = factors[factorId].name || factorId;
                factorValues[factorId] = {
                    factor: {
                        id: factorId,
                        name: factorName
                    },
                    name: valueName,
                    id: valueId
                };
            }
            return factorValues;
        },
        
        _onRunLoading:function(){
            var that = this;
            this._connection.connectRun()
                .done($.proxy(this._fsm.runloaded, this._fsm))
                .fail(function(m){
                    if(m && m.responseJSON && m.responseJSON.message){
                        that._fsm.connecterror("Couldn't connect to experiment: " +  m.responseJSON.message);
                    } else if(m && m.statusText) {
                        that._fsm.connecterror("Couldn't connect to experiment: " +  m.statusText);
                    } else {
                        that._fsm.connecterror("Couldn't connect to experiment.");
                    }
                });
        },
        
        _onBlockLoading: function(){
            this._waitView.startWaiting();
            var that = this;
            $.when(this._connection.currentTrial, this._connection.factors).done(function(trial, factors){
                trial = trial[0];
                factors = factors[0];
                that._fsm.blockloaded({
                    number:trial.block_number,
                    values:that._populateFactorValues(trial.block_values, factors),
                    measure_block_number:trial.measure_block_number,
                    practice: trial.practice
                });
            });
        },
        
        _onLeaveBlockLoading: function(){
            this._waitView.stopWaiting();
        },
        
        _onBlockInit: function(name, from, to, blockInfo){
            this._blockInitView.blockInit(blockInfo).done($.proxy(this._fsm.startblock, this._fsm));
        },
        
        _onTrialLoading: function () {
            var that = this;
            this._waitView.startWaiting();
            this._connection.currentTrial
                .done($.proxy(this._fsm.trialloaded, this._fsm))
                .fail(function (m) {
                    if(m && m.responseJSON && m.responseJSON.message){
                        that._fsm.connecterror("Couldn't retrieve trial info: " +  m.responseJSON.message);
                    } else if(m && m.statusText) {
                        that._fsm.connecterror("Couldn't retrieve trial info: " +  m.statusText);
                    } else {
                        that._fsm.connecterror("Couldn't retrieve trial info");
                    }
                });
        },
        
        _onCrashed: function(name, from, to, message){
            alert(message);
        },
        
        _onLeavetrialloading: function(){
            this._waitView.stopWaiting();
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
            }).fail(function(error){
                that._fsm.error("Task error: "+error);
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