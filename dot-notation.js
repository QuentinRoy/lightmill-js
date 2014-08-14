(function(root, factory) {
    "use strict";

    /* CommonJS */
    if (typeof exports == 'object') module.exports = factory(require('is'));

    /* AMD module */
    else if (typeof define == 'function' && define.amd) define(['is'], factory);

    /* Browser global */
    else root.vector = factory();

}(this, function(is) {
    "use strict";

    var SEP = '.';

    /*!
     * node.extend
     * Copyright 2011, John Resig
     * Dual licensed under the MIT or GPL Version 2 licenses.
     * http://jquery.org/license
     *
     * @fileoverview
     * Port of jQuery.extend that actually works on node.js
     */
    function extend() {
        var target = arguments[0] || {};
        var i = 1;
        var length = arguments.length;
        var deep = false;
        var options, name, src, copy, copy_is_array, clone;

        // Handle a deep copy situation
        if (typeof target === 'boolean') {
            deep = target;
            target = arguments[1] || {};
            // skip the boolean and the target
            i = 2;
        }

        // Handle case when target is a string or something (possible in deep copy)
        if (typeof target !== 'object' && !is.fn(target)) {
            target = {};
        }

        for (; i < length; i++) {
            // Only deal with non-null/undefined values
            options = arguments[i]
            if (options != null) {
                if (typeof options === 'string') {
                    options = options.split('');
                }
                // Extend the base object
                for (name in options) {
                    src = target[name];
                    copy = options[name];

                    // Prevent never-ending loop
                    if (target === copy) {
                        continue;
                    }

                    // Recurse if we're merging plain objects or arrays
                    if (deep && copy && (is.hash(copy) || (copy_is_array = is.array(copy)))) {
                        if (copy_is_array) {
                            copy_is_array = false;
                            clone = src && is.array(src) ? src : [];
                        } else {
                            clone = src && is.hash(src) ? src : {};
                        }

                        // Never move original objects, clone them
                        target[name] = extend(deep, clone, copy);

                        // Don't bring in undefined values
                    } else if (typeof copy !== 'undefined') {
                        target[name] = copy;
                    }
                }
            }
        }

        // Return the modified object
        return target;
    }

    function startWith(str, substr) {
        if (substr.length > str.length) return false;
        return str.slice(0, substr.length) == substr;
    }

    function arrayToObj(array) {
        var obj = {};
        for (var i = 0, n = array.length; i < n; i++) {
            obj[i] = array[i];
        }
        return obj;
    }


    // factorized
    // ----------

    var factorized = (function() {

        function factorized(val) {
            if (val === null ||
                val === undefined ||
                typeof val == 'string') return val;
            else if (is.hash(val)) return factorizedObj(val);
            else if (is.array(val)) return factorizedObj(arrayToObj(val));
            else return val;
        }

        // recursively normalize all the property of an object,
        // and factorize the properties' name using factorizedPath
        function factorizedObj(obj) {
            var propPath, propVal, subObj, newObj = {};
            for (propPath in obj) {
                propVal = obj[propPath];
                propVal = factorized(propVal);
                subObj = factorizedPath(propPath, propVal);
                extend(true, newObj, subObj);
            }
            return newObj;
        }

        // expand a path,
        // e.g. a property ('a.b.c', val) will return into {a: {b: {c: val}}}
        function factorizedPath(strPath, val) {
            var objPath = {},
                last = objPath,
                lastName = null,
                splitName = strPath.split(SEP),
                pathI;
            for (pathI in splitName) {
                if (lastName) {
                    last = last[lastName] = {};
                }
                lastName = splitName[pathI];
            }
            last[lastName] = val;
            return objPath;
        }

        return factorized;

    })();


    // developed
    // ---------

    var developed = (function() {

        function developed(obj) {
            return doDevelopped(obj, '');
        }

        function doDevelopped(obj, prefix) {
            prefix = prefix || '';
            if (!is.hash(obj)) return obj;
            var props = {};
            var subProps, prop;
            for (var propName in obj) {
                if (obj.hasOwnProperty(propName)) {
                    prop = obj[propName];
                    if (is.hash(prop)) {
                        subProps = doDevelopped(prop, prefix + propName + SEP);
                        extend(props, subProps);
                    } else {
                        props[prefix + propName] = prop;
                    }
                }
            }
            return props;
        }

        return developed;

    })();


    // transformed
    // -----------

    var transforms = {
        factorized: factorized,
        developed: developed
    };

    function transformed(obj, form) {
        var f = transforms[form];
        if (f) return f(obj);
        else throw "Unknown form: " + form;
    }


    // set
    // ---

    function set(obj, prop, val, form) {
        if (is.string(prop)) {
            var tmp = {};
            tmp[prop] = val;
            val = tmp;
        } else {
            if (!form) form = val;
            val = prop;
        }
        if (form) val = transformed(val, form);
        extend(true, obj, val);
        return obj;
    }

    // get
    // ---

    var get = (function() {

        function get(obj, targetName) {
            var results = getInArray(obj, targetName);
            if (results.length == 1) return results[0];
            else if (results.length) return results;
        }

        function getInArray(obj, targetName) {
            var results = [];
            var objProp, subResult;
            for (var objPropName in obj) {
                if (obj.hasOwnProperty(objPropName)) {
                    if (objPropName == targetName) {
                        // case we got a leaf
                        objProp = obj[targetName];
                        putGetResult(results, objProp);
                    } else if (startWith(objPropName, targetName + SEP)) {
                        // case sub path (e.g prop='a.c' && obj = {'a.c.d.e':'stuff', 'a.c.e':'stuff'}
                        objProp = obj[objPropName];
                        var subPropName = objPropName.slice(targetName.length + 1);
                        subResult = {};
                        subResult[subPropName] = objProp;
                        putGetResult(results, subResult);
                    } else if (startWith(targetName, objPropName + SEP)) {
                        // case sup path (e.g. prop = 'a.c.d' && obj = {'a.c':{d:'stuff'}})
                        objProp = obj[objPropName];
                        if (is.hash(objProp)) {
                            var subResults = getInArray(objProp,
                                targetName.slice(objPropName.length + 1));
                            for (var i = 0, n = subResults.length; i < n; i++)
                                putGetResult(results, subResults[i]);
                        }
                    }
                }
            }
            return results;
        }

        function putGetResult(target, result) {
            if (result == void(0) || result == null) return;
            var last = target[target.length - 1];
            var isLastArray = is.array(last);
            var isResultArray = is.array(result);
            if (!isLastArray && !is.hash(last) ||
                !isResultArray && !is.hash(result)) {
                target.push(result);
            } else {
                // merge the result with the last result
                if (isLastArray) {
                    last = arrayToObj(last);
                    target[target.length - 1] = last;
                }
                if (isResultArray) {
                    result = arrayToObj(result);
                }
                extend(true, last, result);
            }
        }

        return get;

    })();

    return extend({
        set: set,
        get: get,
        transformed: transformed
    }, transforms);

}));
