define(['./connection', './views/block-init', './views/wait', 'jquery', 'state-machine', './default-config', 'jstools/additions'],
    function (XpConnection, BlockInitView, WaitView, $, StateMachine, defaultConfig) {
        "use strict";

        /**
         * Arguments are in the form {taskManager, mainDiv, targetDiv}
         * Everything is facultative but taskManager.
         * Alternatively, taskManager can be given as first argument.
         */
        function XPManager(taskManager, config) {
            // merge the default config with the provided config
            if (!config && taskManager.config) {
                this._config = $.extend({}, defaultConfig, taskManager);
            } else {
                this._config = $.extend({
                    taskManager: taskManager
                }, defaultConfig, config);
            }

            this._mainDiv = $(this._config.mainDiv);
            this._taskManager = this._config.taskManager;
            taskManager.taskDiv = taskManager.taskDiv || this._mainDiv;
            this._trialResultPromise = null;
            this._currentTrial = null;
            this._blockInitView = new BlockInitView(this._mainDiv);
            this._waitView = new WaitView(this._mainDiv);
            this._connection = new XpConnection(this._config);
            this._targetRun = this._config.run;

            this._fsm = StateMachine.create({
                initial: 'idle',
                events: [
                    { name: 'start',        from: 'idle',           to: 'init'          },
                    { name: 'runloaded',    from: 'init',           to: 'taskinit'      },
                    { name: 'taskready',    from: 'init',           to: 'runloading'    },
                    { name: 'runloaded',    from: 'runloading',     to: 'blockloading'  },
                    { name: 'taskready',    from: 'taskinit',       to: 'blockloading'  },
                    { name: 'blockloaded',  from: 'blockloading',   to: 'blockinit'     },
                    { name: 'xpend',        from: 'blockloading',   to: 'completed'     },
                    { name: 'trialloaded',  from: 'trialloading',   to: 'trialrunning'  },
                    { name: 'trialend',     from: 'trialrunning',   to: 'trialloading'  },
                    { name: 'blockend',     from: 'trialrunning',   to: 'blockloading'  },
                    { name: 'startblock',   from: 'blockinit',      to: 'trialloading'  },
                    { name: 'xpend',        from: 'trialrunning',   to: 'completed'     },
                    { name: 'connecterror', from: '*',              to: 'crashed'       },
                    { name: 'taskerror',    from: '*',              to: 'crashed'       },
                    { name: '*',            from: 'crashed'                             }
                ],
                callbacks: this._getFsmCallbacks()
            });
        }

        XPManager.prototype = {

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

            _onInit: function () {
                var that = this;
                this._waitView.startWaiting();
                this._connection.initExperiment().then(function(){
                        return that._connection.connectRun(that._targetRun);
                }).then(function () {
                    return that._connection.run;
                }).then(function (run) {
                    that._fsm.runloaded();
                    window.document.title += " (" + run.id + ")";
                }).fail(function (m) {
                    if (m && m.responseJSON && m.responseJSON.message) {
                        that._fsm.connecterror("Couldn't connect to experiment: " + m.responseJSON.message);
                    } else if (m && m.statusText) {
                        that._fsm.connecterror("Couldn't connect to experiment: " + m.statusText);
                    } else {
                        that._fsm.connecterror("Couldn't connect to experiment.");
                    }
                });
                $.when(this._taskManager.initTrial()).then(function () {
                    that._fsm.taskready();
                }).fail(function (m) {
                    that._fsm.taskerror("Could not init the task: " + (m ? m : "."));
                });
            },

            _onBlockLoading: function () {
                this._waitView.startWaiting();
                var that = this;
                $.when(this._connection.currentTrial, this._connection.experiment).done(function (trial, experiment) {
                    if(trial) {
                            // trial = trial[0];
                            // experiment = experiment[0];
                            that._fsm.blockloaded({
                                number: trial.block_number,
                                values: that._populateFactorValues(trial.block_values, experiment.factors),
                                measure_block_number: trial.measure_block_number,
                                practice: trial.practice
                            });
                    } else {
                        that._fsm.xpend();
                    }
                }).fail(function (m) {
                    if (m && m.responseJSON && m.responseJSON.message) {
                        that._fsm.connecterror("Couldn't retrieve block info: " + m.responseJSON.message);
                    } else if (m && m.statusText) {
                        that._fsm.connecterror("Couldn't retrieve block info: " + m.statusText);
                    } else {
                        that._fsm.connecterror("Couldn't retrieve block info.");
                    }
                });
            },
            _onLeaveBlockLoading: function () {
                this._waitView.stopWaiting();
            },

            _onBlockInit: function (name, from, to, blockInfo) {
                if(this._taskManager.newBlock) this._taskManager.newBlock(blockInfo);
                this._blockInitView.blockInit(blockInfo).done($.proxy(this._fsm.startblock, this._fsm));
            },

            _onTrialLoading: function () {
                var that = this;
                this._waitView.startWaiting();
                this._connection.currentTrial.done(
                    function (trial) {
                        if (trial) that._fsm.trialloaded(trial);
                        else that._fsm.xpend();
                    }).fail(
                    function (m) {
                        if (m && m.responseJSON && m.responseJSON.message) {
                            that._fsm.connecterror("Couldn't retrieve trial info: " + m.responseJSON.message);
                        } else if (m && m.statusText) {
                            that._fsm.connecterror("Couldn't retrieve trial info: " + m.statusText);
                        } else {
                            that._fsm.connecterror("Couldn't retrieve trial info.");
                        }
                    });
            },

            _onCrashed: function (name, from, to, message) {
                if(from == 'trialrunning') this._taskManager.cancelTrial(message);
                alert(message);
            },

            _onLeavetrialloading: function () {
                this._waitView.stopWaiting();
            },

            _updateTrialSettings: function (trialSettings) {
                trialSettings.allvalues = {};
                var valdicts = [
                    trialSettings.default_values,
                    trialSettings.block_values,
                    trialSettings.values
                ];
                $.each(valdicts, function (i, valdict) {
                    $.each(valdict, function (valName, val) {
                        trialSettings.allvalues[valName] = val;
                    });
                });

            },

            _onTrialRunning: function (name, from, to, trialSettings) {
                var that = this;
                this._updateTrialSettings(trialSettings);
                this._currentTrial = trialSettings;
                this._taskManager.startTrial(trialSettings).done(function (results) {
                    if (trialSettings.number < trialSettings.total - 1) {
                        that._fsm.trialend(results);
                    } else {
                        that._fsm.blockend(results);
                    }
                }).fail(function (error) {
                    that._fsm.error("Task error: " + error);
                });
            },

            _onLeaveTrialRunning: function (name, from, to, trialresult) {
                var that = this;
                this._connection.sendTrialResults(trialresult).fail(
                    function (m) {
                        if (m && m.responseJSON && m.responseJSON.message) {
                            that._fsm.connecterror("Couldn't register trial log: " + m.responseJSON.message);
                        } else if (m && m.statusText) {
                            that._fsm.connecterror("Couldn't register trial log: " + m.statusText);
                        } else {
                            that._fsm.connecterror("Couldn't register trial log.");
                        }
                    });
            },

            _onBeforeEvent: function (name, from, to) {
                if (this._config.debug.managerfsm) {
                    console.log('XP MANAGER FSM: ' + name + ': ' + from + ' -> ' + to);
                }
            },

            _onCompleted: function () {
                // TODO: Well... Use a template?
                var theEnd = $('<div style="text-align:center"><h1>THE END</h1> Thank you for your participation.</div>');
                this._mainDiv.append(theEnd);
            },

            _getFsmCallbacks: function () {
                var callbacks = {};
                for (var prop in this) {
                    if (prop.startsWith("_on")) {
                        var fsmProm = prop.toLowerCase().slice(1),
                            method = this[prop];
                        if (typeof method === "function") {
                            callbacks[fsmProm] = $.proxy(this[prop], this);
                        }
                    }
                }
                return callbacks;
            },

            get started() {
                return this.state !== 'idle';
            },

            get completed() {
                return this.state === 'completed';
            },

            get state() {
                return this._fsm.current;
            }
        };

        return XPManager;

    });
