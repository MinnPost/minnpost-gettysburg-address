
/** vim: et:ts=4:sw=4:sts=4
 * @license RequireJS 2.1.9 Copyright (c) 2010-2012, The Dojo Foundation All Rights Reserved.
 * Available via the MIT or new BSD license.
 * see: http://github.com/jrburke/requirejs for details
 */
//Not using strict: uneven strict support in browsers, #392, and causes
//problems with requirejs.exec()/transpiler plugins that may not be strict.
/*jslint regexp: true, nomen: true, sloppy: true */
/*global window, navigator, document, importScripts, setTimeout, opera */

var requirejs, require, define;
(function (global) {
    var req, s, head, baseElement, dataMain, src,
        interactiveScript, currentlyAddingScript, mainScript, subPath,
        version = '2.1.9',
        commentRegExp = /(\/\*([\s\S]*?)\*\/|([^:]|^)\/\/(.*)$)/mg,
        cjsRequireRegExp = /[^.]\s*require\s*\(\s*["']([^'"\s]+)["']\s*\)/g,
        jsSuffixRegExp = /\.js$/,
        currDirRegExp = /^\.\//,
        op = Object.prototype,
        ostring = op.toString,
        hasOwn = op.hasOwnProperty,
        ap = Array.prototype,
        apsp = ap.splice,
        isBrowser = !!(typeof window !== 'undefined' && typeof navigator !== 'undefined' && window.document),
        isWebWorker = !isBrowser && typeof importScripts !== 'undefined',
        //PS3 indicates loaded and complete, but need to wait for complete
        //specifically. Sequence is 'loading', 'loaded', execution,
        // then 'complete'. The UA check is unfortunate, but not sure how
        //to feature test w/o causing perf issues.
        readyRegExp = isBrowser && navigator.platform === 'PLAYSTATION 3' ?
                      /^complete$/ : /^(complete|loaded)$/,
        defContextName = '_',
        //Oh the tragedy, detecting opera. See the usage of isOpera for reason.
        isOpera = typeof opera !== 'undefined' && opera.toString() === '[object Opera]',
        contexts = {},
        cfg = {},
        globalDefQueue = [],
        useInteractive = false;

    function isFunction(it) {
        return ostring.call(it) === '[object Function]';
    }

    function isArray(it) {
        return ostring.call(it) === '[object Array]';
    }

    /**
     * Helper function for iterating over an array. If the func returns
     * a true value, it will break out of the loop.
     */
    function each(ary, func) {
        if (ary) {
            var i;
            for (i = 0; i < ary.length; i += 1) {
                if (ary[i] && func(ary[i], i, ary)) {
                    break;
                }
            }
        }
    }

    /**
     * Helper function for iterating over an array backwards. If the func
     * returns a true value, it will break out of the loop.
     */
    function eachReverse(ary, func) {
        if (ary) {
            var i;
            for (i = ary.length - 1; i > -1; i -= 1) {
                if (ary[i] && func(ary[i], i, ary)) {
                    break;
                }
            }
        }
    }

    function hasProp(obj, prop) {
        return hasOwn.call(obj, prop);
    }

    function getOwn(obj, prop) {
        return hasProp(obj, prop) && obj[prop];
    }

    /**
     * Cycles over properties in an object and calls a function for each
     * property value. If the function returns a truthy value, then the
     * iteration is stopped.
     */
    function eachProp(obj, func) {
        var prop;
        for (prop in obj) {
            if (hasProp(obj, prop)) {
                if (func(obj[prop], prop)) {
                    break;
                }
            }
        }
    }

    /**
     * Simple function to mix in properties from source into target,
     * but only if target does not already have a property of the same name.
     */
    function mixin(target, source, force, deepStringMixin) {
        if (source) {
            eachProp(source, function (value, prop) {
                if (force || !hasProp(target, prop)) {
                    if (deepStringMixin && typeof value !== 'string') {
                        if (!target[prop]) {
                            target[prop] = {};
                        }
                        mixin(target[prop], value, force, deepStringMixin);
                    } else {
                        target[prop] = value;
                    }
                }
            });
        }
        return target;
    }

    //Similar to Function.prototype.bind, but the 'this' object is specified
    //first, since it is easier to read/figure out what 'this' will be.
    function bind(obj, fn) {
        return function () {
            return fn.apply(obj, arguments);
        };
    }

    function scripts() {
        return document.getElementsByTagName('script');
    }

    function defaultOnError(err) {
        throw err;
    }

    //Allow getting a global that expressed in
    //dot notation, like 'a.b.c'.
    function getGlobal(value) {
        if (!value) {
            return value;
        }
        var g = global;
        each(value.split('.'), function (part) {
            g = g[part];
        });
        return g;
    }

    /**
     * Constructs an error with a pointer to an URL with more information.
     * @param {String} id the error ID that maps to an ID on a web page.
     * @param {String} message human readable error.
     * @param {Error} [err] the original error, if there is one.
     *
     * @returns {Error}
     */
    function makeError(id, msg, err, requireModules) {
        var e = new Error(msg + '\nhttp://requirejs.org/docs/errors.html#' + id);
        e.requireType = id;
        e.requireModules = requireModules;
        if (err) {
            e.originalError = err;
        }
        return e;
    }

    if (typeof define !== 'undefined') {
        //If a define is already in play via another AMD loader,
        //do not overwrite.
        return;
    }

    if (typeof requirejs !== 'undefined') {
        if (isFunction(requirejs)) {
            //Do not overwrite and existing requirejs instance.
            return;
        }
        cfg = requirejs;
        requirejs = undefined;
    }

    //Allow for a require config object
    if (typeof require !== 'undefined' && !isFunction(require)) {
        //assume it is a config object.
        cfg = require;
        require = undefined;
    }

    function newContext(contextName) {
        var inCheckLoaded, Module, context, handlers,
            checkLoadedTimeoutId,
            config = {
                //Defaults. Do not set a default for map
                //config to speed up normalize(), which
                //will run faster if there is no default.
                waitSeconds: 7,
                baseUrl: './',
                paths: {},
                pkgs: {},
                shim: {},
                config: {}
            },
            registry = {},
            //registry of just enabled modules, to speed
            //cycle breaking code when lots of modules
            //are registered, but not activated.
            enabledRegistry = {},
            undefEvents = {},
            defQueue = [],
            defined = {},
            urlFetched = {},
            requireCounter = 1,
            unnormalizedCounter = 1;

        /**
         * Trims the . and .. from an array of path segments.
         * It will keep a leading path segment if a .. will become
         * the first path segment, to help with module name lookups,
         * which act like paths, but can be remapped. But the end result,
         * all paths that use this function should look normalized.
         * NOTE: this method MODIFIES the input array.
         * @param {Array} ary the array of path segments.
         */
        function trimDots(ary) {
            var i, part;
            for (i = 0; ary[i]; i += 1) {
                part = ary[i];
                if (part === '.') {
                    ary.splice(i, 1);
                    i -= 1;
                } else if (part === '..') {
                    if (i === 1 && (ary[2] === '..' || ary[0] === '..')) {
                        //End of the line. Keep at least one non-dot
                        //path segment at the front so it can be mapped
                        //correctly to disk. Otherwise, there is likely
                        //no path mapping for a path starting with '..'.
                        //This can still fail, but catches the most reasonable
                        //uses of ..
                        break;
                    } else if (i > 0) {
                        ary.splice(i - 1, 2);
                        i -= 2;
                    }
                }
            }
        }

        /**
         * Given a relative module name, like ./something, normalize it to
         * a real name that can be mapped to a path.
         * @param {String} name the relative name
         * @param {String} baseName a real name that the name arg is relative
         * to.
         * @param {Boolean} applyMap apply the map config to the value. Should
         * only be done if this normalization is for a dependency ID.
         * @returns {String} normalized name
         */
        function normalize(name, baseName, applyMap) {
            var pkgName, pkgConfig, mapValue, nameParts, i, j, nameSegment,
                foundMap, foundI, foundStarMap, starI,
                baseParts = baseName && baseName.split('/'),
                normalizedBaseParts = baseParts,
                map = config.map,
                starMap = map && map['*'];

            //Adjust any relative paths.
            if (name && name.charAt(0) === '.') {
                //If have a base name, try to normalize against it,
                //otherwise, assume it is a top-level require that will
                //be relative to baseUrl in the end.
                if (baseName) {
                    if (getOwn(config.pkgs, baseName)) {
                        //If the baseName is a package name, then just treat it as one
                        //name to concat the name with.
                        normalizedBaseParts = baseParts = [baseName];
                    } else {
                        //Convert baseName to array, and lop off the last part,
                        //so that . matches that 'directory' and not name of the baseName's
                        //module. For instance, baseName of 'one/two/three', maps to
                        //'one/two/three.js', but we want the directory, 'one/two' for
                        //this normalization.
                        normalizedBaseParts = baseParts.slice(0, baseParts.length - 1);
                    }

                    name = normalizedBaseParts.concat(name.split('/'));
                    trimDots(name);

                    //Some use of packages may use a . path to reference the
                    //'main' module name, so normalize for that.
                    pkgConfig = getOwn(config.pkgs, (pkgName = name[0]));
                    name = name.join('/');
                    if (pkgConfig && name === pkgName + '/' + pkgConfig.main) {
                        name = pkgName;
                    }
                } else if (name.indexOf('./') === 0) {
                    // No baseName, so this is ID is resolved relative
                    // to baseUrl, pull off the leading dot.
                    name = name.substring(2);
                }
            }

            //Apply map config if available.
            if (applyMap && map && (baseParts || starMap)) {
                nameParts = name.split('/');

                for (i = nameParts.length; i > 0; i -= 1) {
                    nameSegment = nameParts.slice(0, i).join('/');

                    if (baseParts) {
                        //Find the longest baseName segment match in the config.
                        //So, do joins on the biggest to smallest lengths of baseParts.
                        for (j = baseParts.length; j > 0; j -= 1) {
                            mapValue = getOwn(map, baseParts.slice(0, j).join('/'));

                            //baseName segment has config, find if it has one for
                            //this name.
                            if (mapValue) {
                                mapValue = getOwn(mapValue, nameSegment);
                                if (mapValue) {
                                    //Match, update name to the new value.
                                    foundMap = mapValue;
                                    foundI = i;
                                    break;
                                }
                            }
                        }
                    }

                    if (foundMap) {
                        break;
                    }

                    //Check for a star map match, but just hold on to it,
                    //if there is a shorter segment match later in a matching
                    //config, then favor over this star map.
                    if (!foundStarMap && starMap && getOwn(starMap, nameSegment)) {
                        foundStarMap = getOwn(starMap, nameSegment);
                        starI = i;
                    }
                }

                if (!foundMap && foundStarMap) {
                    foundMap = foundStarMap;
                    foundI = starI;
                }

                if (foundMap) {
                    nameParts.splice(0, foundI, foundMap);
                    name = nameParts.join('/');
                }
            }

            return name;
        }

        function removeScript(name) {
            if (isBrowser) {
                each(scripts(), function (scriptNode) {
                    if (scriptNode.getAttribute('data-requiremodule') === name &&
                            scriptNode.getAttribute('data-requirecontext') === context.contextName) {
                        scriptNode.parentNode.removeChild(scriptNode);
                        return true;
                    }
                });
            }
        }

        function hasPathFallback(id) {
            var pathConfig = getOwn(config.paths, id);
            if (pathConfig && isArray(pathConfig) && pathConfig.length > 1) {
                //Pop off the first array value, since it failed, and
                //retry
                pathConfig.shift();
                context.require.undef(id);
                context.require([id]);
                return true;
            }
        }

        //Turns a plugin!resource to [plugin, resource]
        //with the plugin being undefined if the name
        //did not have a plugin prefix.
        function splitPrefix(name) {
            var prefix,
                index = name ? name.indexOf('!') : -1;
            if (index > -1) {
                prefix = name.substring(0, index);
                name = name.substring(index + 1, name.length);
            }
            return [prefix, name];
        }

        /**
         * Creates a module mapping that includes plugin prefix, module
         * name, and path. If parentModuleMap is provided it will
         * also normalize the name via require.normalize()
         *
         * @param {String} name the module name
         * @param {String} [parentModuleMap] parent module map
         * for the module name, used to resolve relative names.
         * @param {Boolean} isNormalized: is the ID already normalized.
         * This is true if this call is done for a define() module ID.
         * @param {Boolean} applyMap: apply the map config to the ID.
         * Should only be true if this map is for a dependency.
         *
         * @returns {Object}
         */
        function makeModuleMap(name, parentModuleMap, isNormalized, applyMap) {
            var url, pluginModule, suffix, nameParts,
                prefix = null,
                parentName = parentModuleMap ? parentModuleMap.name : null,
                originalName = name,
                isDefine = true,
                normalizedName = '';

            //If no name, then it means it is a require call, generate an
            //internal name.
            if (!name) {
                isDefine = false;
                name = '_@r' + (requireCounter += 1);
            }

            nameParts = splitPrefix(name);
            prefix = nameParts[0];
            name = nameParts[1];

            if (prefix) {
                prefix = normalize(prefix, parentName, applyMap);
                pluginModule = getOwn(defined, prefix);
            }

            //Account for relative paths if there is a base name.
            if (name) {
                if (prefix) {
                    if (pluginModule && pluginModule.normalize) {
                        //Plugin is loaded, use its normalize method.
                        normalizedName = pluginModule.normalize(name, function (name) {
                            return normalize(name, parentName, applyMap);
                        });
                    } else {
                        normalizedName = normalize(name, parentName, applyMap);
                    }
                } else {
                    //A regular module.
                    normalizedName = normalize(name, parentName, applyMap);

                    //Normalized name may be a plugin ID due to map config
                    //application in normalize. The map config values must
                    //already be normalized, so do not need to redo that part.
                    nameParts = splitPrefix(normalizedName);
                    prefix = nameParts[0];
                    normalizedName = nameParts[1];
                    isNormalized = true;

                    url = context.nameToUrl(normalizedName);
                }
            }

            //If the id is a plugin id that cannot be determined if it needs
            //normalization, stamp it with a unique ID so two matching relative
            //ids that may conflict can be separate.
            suffix = prefix && !pluginModule && !isNormalized ?
                     '_unnormalized' + (unnormalizedCounter += 1) :
                     '';

            return {
                prefix: prefix,
                name: normalizedName,
                parentMap: parentModuleMap,
                unnormalized: !!suffix,
                url: url,
                originalName: originalName,
                isDefine: isDefine,
                id: (prefix ?
                        prefix + '!' + normalizedName :
                        normalizedName) + suffix
            };
        }

        function getModule(depMap) {
            var id = depMap.id,
                mod = getOwn(registry, id);

            if (!mod) {
                mod = registry[id] = new context.Module(depMap);
            }

            return mod;
        }

        function on(depMap, name, fn) {
            var id = depMap.id,
                mod = getOwn(registry, id);

            if (hasProp(defined, id) &&
                    (!mod || mod.defineEmitComplete)) {
                if (name === 'defined') {
                    fn(defined[id]);
                }
            } else {
                mod = getModule(depMap);
                if (mod.error && name === 'error') {
                    fn(mod.error);
                } else {
                    mod.on(name, fn);
                }
            }
        }

        function onError(err, errback) {
            var ids = err.requireModules,
                notified = false;

            if (errback) {
                errback(err);
            } else {
                each(ids, function (id) {
                    var mod = getOwn(registry, id);
                    if (mod) {
                        //Set error on module, so it skips timeout checks.
                        mod.error = err;
                        if (mod.events.error) {
                            notified = true;
                            mod.emit('error', err);
                        }
                    }
                });

                if (!notified) {
                    req.onError(err);
                }
            }
        }

        /**
         * Internal method to transfer globalQueue items to this context's
         * defQueue.
         */
        function takeGlobalQueue() {
            //Push all the globalDefQueue items into the context's defQueue
            if (globalDefQueue.length) {
                //Array splice in the values since the context code has a
                //local var ref to defQueue, so cannot just reassign the one
                //on context.
                apsp.apply(defQueue,
                           [defQueue.length - 1, 0].concat(globalDefQueue));
                globalDefQueue = [];
            }
        }

        handlers = {
            'require': function (mod) {
                if (mod.require) {
                    return mod.require;
                } else {
                    return (mod.require = context.makeRequire(mod.map));
                }
            },
            'exports': function (mod) {
                mod.usingExports = true;
                if (mod.map.isDefine) {
                    if (mod.exports) {
                        return mod.exports;
                    } else {
                        return (mod.exports = defined[mod.map.id] = {});
                    }
                }
            },
            'module': function (mod) {
                if (mod.module) {
                    return mod.module;
                } else {
                    return (mod.module = {
                        id: mod.map.id,
                        uri: mod.map.url,
                        config: function () {
                            var c,
                                pkg = getOwn(config.pkgs, mod.map.id);
                            // For packages, only support config targeted
                            // at the main module.
                            c = pkg ? getOwn(config.config, mod.map.id + '/' + pkg.main) :
                                      getOwn(config.config, mod.map.id);
                            return  c || {};
                        },
                        exports: defined[mod.map.id]
                    });
                }
            }
        };

        function cleanRegistry(id) {
            //Clean up machinery used for waiting modules.
            delete registry[id];
            delete enabledRegistry[id];
        }

        function breakCycle(mod, traced, processed) {
            var id = mod.map.id;

            if (mod.error) {
                mod.emit('error', mod.error);
            } else {
                traced[id] = true;
                each(mod.depMaps, function (depMap, i) {
                    var depId = depMap.id,
                        dep = getOwn(registry, depId);

                    //Only force things that have not completed
                    //being defined, so still in the registry,
                    //and only if it has not been matched up
                    //in the module already.
                    if (dep && !mod.depMatched[i] && !processed[depId]) {
                        if (getOwn(traced, depId)) {
                            mod.defineDep(i, defined[depId]);
                            mod.check(); //pass false?
                        } else {
                            breakCycle(dep, traced, processed);
                        }
                    }
                });
                processed[id] = true;
            }
        }

        function checkLoaded() {
            var map, modId, err, usingPathFallback,
                waitInterval = config.waitSeconds * 1000,
                //It is possible to disable the wait interval by using waitSeconds of 0.
                expired = waitInterval && (context.startTime + waitInterval) < new Date().getTime(),
                noLoads = [],
                reqCalls = [],
                stillLoading = false,
                needCycleCheck = true;

            //Do not bother if this call was a result of a cycle break.
            if (inCheckLoaded) {
                return;
            }

            inCheckLoaded = true;

            //Figure out the state of all the modules.
            eachProp(enabledRegistry, function (mod) {
                map = mod.map;
                modId = map.id;

                //Skip things that are not enabled or in error state.
                if (!mod.enabled) {
                    return;
                }

                if (!map.isDefine) {
                    reqCalls.push(mod);
                }

                if (!mod.error) {
                    //If the module should be executed, and it has not
                    //been inited and time is up, remember it.
                    if (!mod.inited && expired) {
                        if (hasPathFallback(modId)) {
                            usingPathFallback = true;
                            stillLoading = true;
                        } else {
                            noLoads.push(modId);
                            removeScript(modId);
                        }
                    } else if (!mod.inited && mod.fetched && map.isDefine) {
                        stillLoading = true;
                        if (!map.prefix) {
                            //No reason to keep looking for unfinished
                            //loading. If the only stillLoading is a
                            //plugin resource though, keep going,
                            //because it may be that a plugin resource
                            //is waiting on a non-plugin cycle.
                            return (needCycleCheck = false);
                        }
                    }
                }
            });

            if (expired && noLoads.length) {
                //If wait time expired, throw error of unloaded modules.
                err = makeError('timeout', 'Load timeout for modules: ' + noLoads, null, noLoads);
                err.contextName = context.contextName;
                return onError(err);
            }

            //Not expired, check for a cycle.
            if (needCycleCheck) {
                each(reqCalls, function (mod) {
                    breakCycle(mod, {}, {});
                });
            }

            //If still waiting on loads, and the waiting load is something
            //other than a plugin resource, or there are still outstanding
            //scripts, then just try back later.
            if ((!expired || usingPathFallback) && stillLoading) {
                //Something is still waiting to load. Wait for it, but only
                //if a timeout is not already in effect.
                if ((isBrowser || isWebWorker) && !checkLoadedTimeoutId) {
                    checkLoadedTimeoutId = setTimeout(function () {
                        checkLoadedTimeoutId = 0;
                        checkLoaded();
                    }, 50);
                }
            }

            inCheckLoaded = false;
        }

        Module = function (map) {
            this.events = getOwn(undefEvents, map.id) || {};
            this.map = map;
            this.shim = getOwn(config.shim, map.id);
            this.depExports = [];
            this.depMaps = [];
            this.depMatched = [];
            this.pluginMaps = {};
            this.depCount = 0;

            /* this.exports this.factory
               this.depMaps = [],
               this.enabled, this.fetched
            */
        };

        Module.prototype = {
            init: function (depMaps, factory, errback, options) {
                options = options || {};

                //Do not do more inits if already done. Can happen if there
                //are multiple define calls for the same module. That is not
                //a normal, common case, but it is also not unexpected.
                if (this.inited) {
                    return;
                }

                this.factory = factory;

                if (errback) {
                    //Register for errors on this module.
                    this.on('error', errback);
                } else if (this.events.error) {
                    //If no errback already, but there are error listeners
                    //on this module, set up an errback to pass to the deps.
                    errback = bind(this, function (err) {
                        this.emit('error', err);
                    });
                }

                //Do a copy of the dependency array, so that
                //source inputs are not modified. For example
                //"shim" deps are passed in here directly, and
                //doing a direct modification of the depMaps array
                //would affect that config.
                this.depMaps = depMaps && depMaps.slice(0);

                this.errback = errback;

                //Indicate this module has be initialized
                this.inited = true;

                this.ignore = options.ignore;

                //Could have option to init this module in enabled mode,
                //or could have been previously marked as enabled. However,
                //the dependencies are not known until init is called. So
                //if enabled previously, now trigger dependencies as enabled.
                if (options.enabled || this.enabled) {
                    //Enable this module and dependencies.
                    //Will call this.check()
                    this.enable();
                } else {
                    this.check();
                }
            },

            defineDep: function (i, depExports) {
                //Because of cycles, defined callback for a given
                //export can be called more than once.
                if (!this.depMatched[i]) {
                    this.depMatched[i] = true;
                    this.depCount -= 1;
                    this.depExports[i] = depExports;
                }
            },

            fetch: function () {
                if (this.fetched) {
                    return;
                }
                this.fetched = true;

                context.startTime = (new Date()).getTime();

                var map = this.map;

                //If the manager is for a plugin managed resource,
                //ask the plugin to load it now.
                if (this.shim) {
                    context.makeRequire(this.map, {
                        enableBuildCallback: true
                    })(this.shim.deps || [], bind(this, function () {
                        return map.prefix ? this.callPlugin() : this.load();
                    }));
                } else {
                    //Regular dependency.
                    return map.prefix ? this.callPlugin() : this.load();
                }
            },

            load: function () {
                var url = this.map.url;

                //Regular dependency.
                if (!urlFetched[url]) {
                    urlFetched[url] = true;
                    context.load(this.map.id, url);
                }
            },

            /**
             * Checks if the module is ready to define itself, and if so,
             * define it.
             */
            check: function () {
                if (!this.enabled || this.enabling) {
                    return;
                }

                var err, cjsModule,
                    id = this.map.id,
                    depExports = this.depExports,
                    exports = this.exports,
                    factory = this.factory;

                if (!this.inited) {
                    this.fetch();
                } else if (this.error) {
                    this.emit('error', this.error);
                } else if (!this.defining) {
                    //The factory could trigger another require call
                    //that would result in checking this module to
                    //define itself again. If already in the process
                    //of doing that, skip this work.
                    this.defining = true;

                    if (this.depCount < 1 && !this.defined) {
                        if (isFunction(factory)) {
                            //If there is an error listener, favor passing
                            //to that instead of throwing an error. However,
                            //only do it for define()'d  modules. require
                            //errbacks should not be called for failures in
                            //their callbacks (#699). However if a global
                            //onError is set, use that.
                            if ((this.events.error && this.map.isDefine) ||
                                req.onError !== defaultOnError) {
                                try {
                                    exports = context.execCb(id, factory, depExports, exports);
                                } catch (e) {
                                    err = e;
                                }
                            } else {
                                exports = context.execCb(id, factory, depExports, exports);
                            }

                            if (this.map.isDefine) {
                                //If setting exports via 'module' is in play,
                                //favor that over return value and exports. After that,
                                //favor a non-undefined return value over exports use.
                                cjsModule = this.module;
                                if (cjsModule &&
                                        cjsModule.exports !== undefined &&
                                        //Make sure it is not already the exports value
                                        cjsModule.exports !== this.exports) {
                                    exports = cjsModule.exports;
                                } else if (exports === undefined && this.usingExports) {
                                    //exports already set the defined value.
                                    exports = this.exports;
                                }
                            }

                            if (err) {
                                err.requireMap = this.map;
                                err.requireModules = this.map.isDefine ? [this.map.id] : null;
                                err.requireType = this.map.isDefine ? 'define' : 'require';
                                return onError((this.error = err));
                            }

                        } else {
                            //Just a literal value
                            exports = factory;
                        }

                        this.exports = exports;

                        if (this.map.isDefine && !this.ignore) {
                            defined[id] = exports;

                            if (req.onResourceLoad) {
                                req.onResourceLoad(context, this.map, this.depMaps);
                            }
                        }

                        //Clean up
                        cleanRegistry(id);

                        this.defined = true;
                    }

                    //Finished the define stage. Allow calling check again
                    //to allow define notifications below in the case of a
                    //cycle.
                    this.defining = false;

                    if (this.defined && !this.defineEmitted) {
                        this.defineEmitted = true;
                        this.emit('defined', this.exports);
                        this.defineEmitComplete = true;
                    }

                }
            },

            callPlugin: function () {
                var map = this.map,
                    id = map.id,
                    //Map already normalized the prefix.
                    pluginMap = makeModuleMap(map.prefix);

                //Mark this as a dependency for this plugin, so it
                //can be traced for cycles.
                this.depMaps.push(pluginMap);

                on(pluginMap, 'defined', bind(this, function (plugin) {
                    var load, normalizedMap, normalizedMod,
                        name = this.map.name,
                        parentName = this.map.parentMap ? this.map.parentMap.name : null,
                        localRequire = context.makeRequire(map.parentMap, {
                            enableBuildCallback: true
                        });

                    //If current map is not normalized, wait for that
                    //normalized name to load instead of continuing.
                    if (this.map.unnormalized) {
                        //Normalize the ID if the plugin allows it.
                        if (plugin.normalize) {
                            name = plugin.normalize(name, function (name) {
                                return normalize(name, parentName, true);
                            }) || '';
                        }

                        //prefix and name should already be normalized, no need
                        //for applying map config again either.
                        normalizedMap = makeModuleMap(map.prefix + '!' + name,
                                                      this.map.parentMap);
                        on(normalizedMap,
                            'defined', bind(this, function (value) {
                                this.init([], function () { return value; }, null, {
                                    enabled: true,
                                    ignore: true
                                });
                            }));

                        normalizedMod = getOwn(registry, normalizedMap.id);
                        if (normalizedMod) {
                            //Mark this as a dependency for this plugin, so it
                            //can be traced for cycles.
                            this.depMaps.push(normalizedMap);

                            if (this.events.error) {
                                normalizedMod.on('error', bind(this, function (err) {
                                    this.emit('error', err);
                                }));
                            }
                            normalizedMod.enable();
                        }

                        return;
                    }

                    load = bind(this, function (value) {
                        this.init([], function () { return value; }, null, {
                            enabled: true
                        });
                    });

                    load.error = bind(this, function (err) {
                        this.inited = true;
                        this.error = err;
                        err.requireModules = [id];

                        //Remove temp unnormalized modules for this module,
                        //since they will never be resolved otherwise now.
                        eachProp(registry, function (mod) {
                            if (mod.map.id.indexOf(id + '_unnormalized') === 0) {
                                cleanRegistry(mod.map.id);
                            }
                        });

                        onError(err);
                    });

                    //Allow plugins to load other code without having to know the
                    //context or how to 'complete' the load.
                    load.fromText = bind(this, function (text, textAlt) {
                        /*jslint evil: true */
                        var moduleName = map.name,
                            moduleMap = makeModuleMap(moduleName),
                            hasInteractive = useInteractive;

                        //As of 2.1.0, support just passing the text, to reinforce
                        //fromText only being called once per resource. Still
                        //support old style of passing moduleName but discard
                        //that moduleName in favor of the internal ref.
                        if (textAlt) {
                            text = textAlt;
                        }

                        //Turn off interactive script matching for IE for any define
                        //calls in the text, then turn it back on at the end.
                        if (hasInteractive) {
                            useInteractive = false;
                        }

                        //Prime the system by creating a module instance for
                        //it.
                        getModule(moduleMap);

                        //Transfer any config to this other module.
                        if (hasProp(config.config, id)) {
                            config.config[moduleName] = config.config[id];
                        }

                        try {
                            req.exec(text);
                        } catch (e) {
                            return onError(makeError('fromtexteval',
                                             'fromText eval for ' + id +
                                            ' failed: ' + e,
                                             e,
                                             [id]));
                        }

                        if (hasInteractive) {
                            useInteractive = true;
                        }

                        //Mark this as a dependency for the plugin
                        //resource
                        this.depMaps.push(moduleMap);

                        //Support anonymous modules.
                        context.completeLoad(moduleName);

                        //Bind the value of that module to the value for this
                        //resource ID.
                        localRequire([moduleName], load);
                    });

                    //Use parentName here since the plugin's name is not reliable,
                    //could be some weird string with no path that actually wants to
                    //reference the parentName's path.
                    plugin.load(map.name, localRequire, load, config);
                }));

                context.enable(pluginMap, this);
                this.pluginMaps[pluginMap.id] = pluginMap;
            },

            enable: function () {
                enabledRegistry[this.map.id] = this;
                this.enabled = true;

                //Set flag mentioning that the module is enabling,
                //so that immediate calls to the defined callbacks
                //for dependencies do not trigger inadvertent load
                //with the depCount still being zero.
                this.enabling = true;

                //Enable each dependency
                each(this.depMaps, bind(this, function (depMap, i) {
                    var id, mod, handler;

                    if (typeof depMap === 'string') {
                        //Dependency needs to be converted to a depMap
                        //and wired up to this module.
                        depMap = makeModuleMap(depMap,
                                               (this.map.isDefine ? this.map : this.map.parentMap),
                                               false,
                                               !this.skipMap);
                        this.depMaps[i] = depMap;

                        handler = getOwn(handlers, depMap.id);

                        if (handler) {
                            this.depExports[i] = handler(this);
                            return;
                        }

                        this.depCount += 1;

                        on(depMap, 'defined', bind(this, function (depExports) {
                            this.defineDep(i, depExports);
                            this.check();
                        }));

                        if (this.errback) {
                            on(depMap, 'error', bind(this, this.errback));
                        }
                    }

                    id = depMap.id;
                    mod = registry[id];

                    //Skip special modules like 'require', 'exports', 'module'
                    //Also, don't call enable if it is already enabled,
                    //important in circular dependency cases.
                    if (!hasProp(handlers, id) && mod && !mod.enabled) {
                        context.enable(depMap, this);
                    }
                }));

                //Enable each plugin that is used in
                //a dependency
                eachProp(this.pluginMaps, bind(this, function (pluginMap) {
                    var mod = getOwn(registry, pluginMap.id);
                    if (mod && !mod.enabled) {
                        context.enable(pluginMap, this);
                    }
                }));

                this.enabling = false;

                this.check();
            },

            on: function (name, cb) {
                var cbs = this.events[name];
                if (!cbs) {
                    cbs = this.events[name] = [];
                }
                cbs.push(cb);
            },

            emit: function (name, evt) {
                each(this.events[name], function (cb) {
                    cb(evt);
                });
                if (name === 'error') {
                    //Now that the error handler was triggered, remove
                    //the listeners, since this broken Module instance
                    //can stay around for a while in the registry.
                    delete this.events[name];
                }
            }
        };

        function callGetModule(args) {
            //Skip modules already defined.
            if (!hasProp(defined, args[0])) {
                getModule(makeModuleMap(args[0], null, true)).init(args[1], args[2]);
            }
        }

        function removeListener(node, func, name, ieName) {
            //Favor detachEvent because of IE9
            //issue, see attachEvent/addEventListener comment elsewhere
            //in this file.
            if (node.detachEvent && !isOpera) {
                //Probably IE. If not it will throw an error, which will be
                //useful to know.
                if (ieName) {
                    node.detachEvent(ieName, func);
                }
            } else {
                node.removeEventListener(name, func, false);
            }
        }

        /**
         * Given an event from a script node, get the requirejs info from it,
         * and then removes the event listeners on the node.
         * @param {Event} evt
         * @returns {Object}
         */
        function getScriptData(evt) {
            //Using currentTarget instead of target for Firefox 2.0's sake. Not
            //all old browsers will be supported, but this one was easy enough
            //to support and still makes sense.
            var node = evt.currentTarget || evt.srcElement;

            //Remove the listeners once here.
            removeListener(node, context.onScriptLoad, 'load', 'onreadystatechange');
            removeListener(node, context.onScriptError, 'error');

            return {
                node: node,
                id: node && node.getAttribute('data-requiremodule')
            };
        }

        function intakeDefines() {
            var args;

            //Any defined modules in the global queue, intake them now.
            takeGlobalQueue();

            //Make sure any remaining defQueue items get properly processed.
            while (defQueue.length) {
                args = defQueue.shift();
                if (args[0] === null) {
                    return onError(makeError('mismatch', 'Mismatched anonymous define() module: ' + args[args.length - 1]));
                } else {
                    //args are id, deps, factory. Should be normalized by the
                    //define() function.
                    callGetModule(args);
                }
            }
        }

        context = {
            config: config,
            contextName: contextName,
            registry: registry,
            defined: defined,
            urlFetched: urlFetched,
            defQueue: defQueue,
            Module: Module,
            makeModuleMap: makeModuleMap,
            nextTick: req.nextTick,
            onError: onError,

            /**
             * Set a configuration for the context.
             * @param {Object} cfg config object to integrate.
             */
            configure: function (cfg) {
                //Make sure the baseUrl ends in a slash.
                if (cfg.baseUrl) {
                    if (cfg.baseUrl.charAt(cfg.baseUrl.length - 1) !== '/') {
                        cfg.baseUrl += '/';
                    }
                }

                //Save off the paths and packages since they require special processing,
                //they are additive.
                var pkgs = config.pkgs,
                    shim = config.shim,
                    objs = {
                        paths: true,
                        config: true,
                        map: true
                    };

                eachProp(cfg, function (value, prop) {
                    if (objs[prop]) {
                        if (prop === 'map') {
                            if (!config.map) {
                                config.map = {};
                            }
                            mixin(config[prop], value, true, true);
                        } else {
                            mixin(config[prop], value, true);
                        }
                    } else {
                        config[prop] = value;
                    }
                });

                //Merge shim
                if (cfg.shim) {
                    eachProp(cfg.shim, function (value, id) {
                        //Normalize the structure
                        if (isArray(value)) {
                            value = {
                                deps: value
                            };
                        }
                        if ((value.exports || value.init) && !value.exportsFn) {
                            value.exportsFn = context.makeShimExports(value);
                        }
                        shim[id] = value;
                    });
                    config.shim = shim;
                }

                //Adjust packages if necessary.
                if (cfg.packages) {
                    each(cfg.packages, function (pkgObj) {
                        var location;

                        pkgObj = typeof pkgObj === 'string' ? { name: pkgObj } : pkgObj;
                        location = pkgObj.location;

                        //Create a brand new object on pkgs, since currentPackages can
                        //be passed in again, and config.pkgs is the internal transformed
                        //state for all package configs.
                        pkgs[pkgObj.name] = {
                            name: pkgObj.name,
                            location: location || pkgObj.name,
                            //Remove leading dot in main, so main paths are normalized,
                            //and remove any trailing .js, since different package
                            //envs have different conventions: some use a module name,
                            //some use a file name.
                            main: (pkgObj.main || 'main')
                                  .replace(currDirRegExp, '')
                                  .replace(jsSuffixRegExp, '')
                        };
                    });

                    //Done with modifications, assing packages back to context config
                    config.pkgs = pkgs;
                }

                //If there are any "waiting to execute" modules in the registry,
                //update the maps for them, since their info, like URLs to load,
                //may have changed.
                eachProp(registry, function (mod, id) {
                    //If module already has init called, since it is too
                    //late to modify them, and ignore unnormalized ones
                    //since they are transient.
                    if (!mod.inited && !mod.map.unnormalized) {
                        mod.map = makeModuleMap(id);
                    }
                });

                //If a deps array or a config callback is specified, then call
                //require with those args. This is useful when require is defined as a
                //config object before require.js is loaded.
                if (cfg.deps || cfg.callback) {
                    context.require(cfg.deps || [], cfg.callback);
                }
            },

            makeShimExports: function (value) {
                function fn() {
                    var ret;
                    if (value.init) {
                        ret = value.init.apply(global, arguments);
                    }
                    return ret || (value.exports && getGlobal(value.exports));
                }
                return fn;
            },

            makeRequire: function (relMap, options) {
                options = options || {};

                function localRequire(deps, callback, errback) {
                    var id, map, requireMod;

                    if (options.enableBuildCallback && callback && isFunction(callback)) {
                        callback.__requireJsBuild = true;
                    }

                    if (typeof deps === 'string') {
                        if (isFunction(callback)) {
                            //Invalid call
                            return onError(makeError('requireargs', 'Invalid require call'), errback);
                        }

                        //If require|exports|module are requested, get the
                        //value for them from the special handlers. Caveat:
                        //this only works while module is being defined.
                        if (relMap && hasProp(handlers, deps)) {
                            return handlers[deps](registry[relMap.id]);
                        }

                        //Synchronous access to one module. If require.get is
                        //available (as in the Node adapter), prefer that.
                        if (req.get) {
                            return req.get(context, deps, relMap, localRequire);
                        }

                        //Normalize module name, if it contains . or ..
                        map = makeModuleMap(deps, relMap, false, true);
                        id = map.id;

                        if (!hasProp(defined, id)) {
                            return onError(makeError('notloaded', 'Module name "' +
                                        id +
                                        '" has not been loaded yet for context: ' +
                                        contextName +
                                        (relMap ? '' : '. Use require([])')));
                        }
                        return defined[id];
                    }

                    //Grab defines waiting in the global queue.
                    intakeDefines();

                    //Mark all the dependencies as needing to be loaded.
                    context.nextTick(function () {
                        //Some defines could have been added since the
                        //require call, collect them.
                        intakeDefines();

                        requireMod = getModule(makeModuleMap(null, relMap));

                        //Store if map config should be applied to this require
                        //call for dependencies.
                        requireMod.skipMap = options.skipMap;

                        requireMod.init(deps, callback, errback, {
                            enabled: true
                        });

                        checkLoaded();
                    });

                    return localRequire;
                }

                mixin(localRequire, {
                    isBrowser: isBrowser,

                    /**
                     * Converts a module name + .extension into an URL path.
                     * *Requires* the use of a module name. It does not support using
                     * plain URLs like nameToUrl.
                     */
                    toUrl: function (moduleNamePlusExt) {
                        var ext,
                            index = moduleNamePlusExt.lastIndexOf('.'),
                            segment = moduleNamePlusExt.split('/')[0],
                            isRelative = segment === '.' || segment === '..';

                        //Have a file extension alias, and it is not the
                        //dots from a relative path.
                        if (index !== -1 && (!isRelative || index > 1)) {
                            ext = moduleNamePlusExt.substring(index, moduleNamePlusExt.length);
                            moduleNamePlusExt = moduleNamePlusExt.substring(0, index);
                        }

                        return context.nameToUrl(normalize(moduleNamePlusExt,
                                                relMap && relMap.id, true), ext,  true);
                    },

                    defined: function (id) {
                        return hasProp(defined, makeModuleMap(id, relMap, false, true).id);
                    },

                    specified: function (id) {
                        id = makeModuleMap(id, relMap, false, true).id;
                        return hasProp(defined, id) || hasProp(registry, id);
                    }
                });

                //Only allow undef on top level require calls
                if (!relMap) {
                    localRequire.undef = function (id) {
                        //Bind any waiting define() calls to this context,
                        //fix for #408
                        takeGlobalQueue();

                        var map = makeModuleMap(id, relMap, true),
                            mod = getOwn(registry, id);

                        removeScript(id);

                        delete defined[id];
                        delete urlFetched[map.url];
                        delete undefEvents[id];

                        if (mod) {
                            //Hold on to listeners in case the
                            //module will be attempted to be reloaded
                            //using a different config.
                            if (mod.events.defined) {
                                undefEvents[id] = mod.events;
                            }

                            cleanRegistry(id);
                        }
                    };
                }

                return localRequire;
            },

            /**
             * Called to enable a module if it is still in the registry
             * awaiting enablement. A second arg, parent, the parent module,
             * is passed in for context, when this method is overriden by
             * the optimizer. Not shown here to keep code compact.
             */
            enable: function (depMap) {
                var mod = getOwn(registry, depMap.id);
                if (mod) {
                    getModule(depMap).enable();
                }
            },

            /**
             * Internal method used by environment adapters to complete a load event.
             * A load event could be a script load or just a load pass from a synchronous
             * load call.
             * @param {String} moduleName the name of the module to potentially complete.
             */
            completeLoad: function (moduleName) {
                var found, args, mod,
                    shim = getOwn(config.shim, moduleName) || {},
                    shExports = shim.exports;

                takeGlobalQueue();

                while (defQueue.length) {
                    args = defQueue.shift();
                    if (args[0] === null) {
                        args[0] = moduleName;
                        //If already found an anonymous module and bound it
                        //to this name, then this is some other anon module
                        //waiting for its completeLoad to fire.
                        if (found) {
                            break;
                        }
                        found = true;
                    } else if (args[0] === moduleName) {
                        //Found matching define call for this script!
                        found = true;
                    }

                    callGetModule(args);
                }

                //Do this after the cycle of callGetModule in case the result
                //of those calls/init calls changes the registry.
                mod = getOwn(registry, moduleName);

                if (!found && !hasProp(defined, moduleName) && mod && !mod.inited) {
                    if (config.enforceDefine && (!shExports || !getGlobal(shExports))) {
                        if (hasPathFallback(moduleName)) {
                            return;
                        } else {
                            return onError(makeError('nodefine',
                                             'No define call for ' + moduleName,
                                             null,
                                             [moduleName]));
                        }
                    } else {
                        //A script that does not call define(), so just simulate
                        //the call for it.
                        callGetModule([moduleName, (shim.deps || []), shim.exportsFn]);
                    }
                }

                checkLoaded();
            },

            /**
             * Converts a module name to a file path. Supports cases where
             * moduleName may actually be just an URL.
             * Note that it **does not** call normalize on the moduleName,
             * it is assumed to have already been normalized. This is an
             * internal API, not a public one. Use toUrl for the public API.
             */
            nameToUrl: function (moduleName, ext, skipExt) {
                var paths, pkgs, pkg, pkgPath, syms, i, parentModule, url,
                    parentPath;

                //If a colon is in the URL, it indicates a protocol is used and it is just
                //an URL to a file, or if it starts with a slash, contains a query arg (i.e. ?)
                //or ends with .js, then assume the user meant to use an url and not a module id.
                //The slash is important for protocol-less URLs as well as full paths.
                if (req.jsExtRegExp.test(moduleName)) {
                    //Just a plain path, not module name lookup, so just return it.
                    //Add extension if it is included. This is a bit wonky, only non-.js things pass
                    //an extension, this method probably needs to be reworked.
                    url = moduleName + (ext || '');
                } else {
                    //A module that needs to be converted to a path.
                    paths = config.paths;
                    pkgs = config.pkgs;

                    syms = moduleName.split('/');
                    //For each module name segment, see if there is a path
                    //registered for it. Start with most specific name
                    //and work up from it.
                    for (i = syms.length; i > 0; i -= 1) {
                        parentModule = syms.slice(0, i).join('/');
                        pkg = getOwn(pkgs, parentModule);
                        parentPath = getOwn(paths, parentModule);
                        if (parentPath) {
                            //If an array, it means there are a few choices,
                            //Choose the one that is desired
                            if (isArray(parentPath)) {
                                parentPath = parentPath[0];
                            }
                            syms.splice(0, i, parentPath);
                            break;
                        } else if (pkg) {
                            //If module name is just the package name, then looking
                            //for the main module.
                            if (moduleName === pkg.name) {
                                pkgPath = pkg.location + '/' + pkg.main;
                            } else {
                                pkgPath = pkg.location;
                            }
                            syms.splice(0, i, pkgPath);
                            break;
                        }
                    }

                    //Join the path parts together, then figure out if baseUrl is needed.
                    url = syms.join('/');
                    url += (ext || (/^data\:|\?/.test(url) || skipExt ? '' : '.js'));
                    url = (url.charAt(0) === '/' || url.match(/^[\w\+\.\-]+:/) ? '' : config.baseUrl) + url;
                }

                return config.urlArgs ? url +
                                        ((url.indexOf('?') === -1 ? '?' : '&') +
                                         config.urlArgs) : url;
            },

            //Delegates to req.load. Broken out as a separate function to
            //allow overriding in the optimizer.
            load: function (id, url) {
                req.load(context, id, url);
            },

            /**
             * Executes a module callback function. Broken out as a separate function
             * solely to allow the build system to sequence the files in the built
             * layer in the right sequence.
             *
             * @private
             */
            execCb: function (name, callback, args, exports) {
                return callback.apply(exports, args);
            },

            /**
             * callback for script loads, used to check status of loading.
             *
             * @param {Event} evt the event from the browser for the script
             * that was loaded.
             */
            onScriptLoad: function (evt) {
                //Using currentTarget instead of target for Firefox 2.0's sake. Not
                //all old browsers will be supported, but this one was easy enough
                //to support and still makes sense.
                if (evt.type === 'load' ||
                        (readyRegExp.test((evt.currentTarget || evt.srcElement).readyState))) {
                    //Reset interactive script so a script node is not held onto for
                    //to long.
                    interactiveScript = null;

                    //Pull out the name of the module and the context.
                    var data = getScriptData(evt);
                    context.completeLoad(data.id);
                }
            },

            /**
             * Callback for script errors.
             */
            onScriptError: function (evt) {
                var data = getScriptData(evt);
                if (!hasPathFallback(data.id)) {
                    return onError(makeError('scripterror', 'Script error for: ' + data.id, evt, [data.id]));
                }
            }
        };

        context.require = context.makeRequire();
        return context;
    }

    /**
     * Main entry point.
     *
     * If the only argument to require is a string, then the module that
     * is represented by that string is fetched for the appropriate context.
     *
     * If the first argument is an array, then it will be treated as an array
     * of dependency string names to fetch. An optional function callback can
     * be specified to execute when all of those dependencies are available.
     *
     * Make a local req variable to help Caja compliance (it assumes things
     * on a require that are not standardized), and to give a short
     * name for minification/local scope use.
     */
    req = requirejs = function (deps, callback, errback, optional) {

        //Find the right context, use default
        var context, config,
            contextName = defContextName;

        // Determine if have config object in the call.
        if (!isArray(deps) && typeof deps !== 'string') {
            // deps is a config object
            config = deps;
            if (isArray(callback)) {
                // Adjust args if there are dependencies
                deps = callback;
                callback = errback;
                errback = optional;
            } else {
                deps = [];
            }
        }

        if (config && config.context) {
            contextName = config.context;
        }

        context = getOwn(contexts, contextName);
        if (!context) {
            context = contexts[contextName] = req.s.newContext(contextName);
        }

        if (config) {
            context.configure(config);
        }

        return context.require(deps, callback, errback);
    };

    /**
     * Support require.config() to make it easier to cooperate with other
     * AMD loaders on globally agreed names.
     */
    req.config = function (config) {
        return req(config);
    };

    /**
     * Execute something after the current tick
     * of the event loop. Override for other envs
     * that have a better solution than setTimeout.
     * @param  {Function} fn function to execute later.
     */
    req.nextTick = typeof setTimeout !== 'undefined' ? function (fn) {
        setTimeout(fn, 4);
    } : function (fn) { fn(); };

    /**
     * Export require as a global, but only if it does not already exist.
     */
    if (!require) {
        require = req;
    }

    req.version = version;

    //Used to filter out dependencies that are already paths.
    req.jsExtRegExp = /^\/|:|\?|\.js$/;
    req.isBrowser = isBrowser;
    s = req.s = {
        contexts: contexts,
        newContext: newContext
    };

    //Create default context.
    req({});

    //Exports some context-sensitive methods on global require.
    each([
        'toUrl',
        'undef',
        'defined',
        'specified'
    ], function (prop) {
        //Reference from contexts instead of early binding to default context,
        //so that during builds, the latest instance of the default context
        //with its config gets used.
        req[prop] = function () {
            var ctx = contexts[defContextName];
            return ctx.require[prop].apply(ctx, arguments);
        };
    });

    if (isBrowser) {
        head = s.head = document.getElementsByTagName('head')[0];
        //If BASE tag is in play, using appendChild is a problem for IE6.
        //When that browser dies, this can be removed. Details in this jQuery bug:
        //http://dev.jquery.com/ticket/2709
        baseElement = document.getElementsByTagName('base')[0];
        if (baseElement) {
            head = s.head = baseElement.parentNode;
        }
    }

    /**
     * Any errors that require explicitly generates will be passed to this
     * function. Intercept/override it if you want custom error handling.
     * @param {Error} err the error object.
     */
    req.onError = defaultOnError;

    /**
     * Creates the node for the load command. Only used in browser envs.
     */
    req.createNode = function (config, moduleName, url) {
        var node = config.xhtml ?
                document.createElementNS('http://www.w3.org/1999/xhtml', 'html:script') :
                document.createElement('script');
        node.type = config.scriptType || 'text/javascript';
        node.charset = 'utf-8';
        node.async = true;
        return node;
    };

    /**
     * Does the request to load a module for the browser case.
     * Make this a separate function to allow other environments
     * to override it.
     *
     * @param {Object} context the require context to find state.
     * @param {String} moduleName the name of the module.
     * @param {Object} url the URL to the module.
     */
    req.load = function (context, moduleName, url) {
        var config = (context && context.config) || {},
            node;
        if (isBrowser) {
            //In the browser so use a script tag
            node = req.createNode(config, moduleName, url);

            node.setAttribute('data-requirecontext', context.contextName);
            node.setAttribute('data-requiremodule', moduleName);

            //Set up load listener. Test attachEvent first because IE9 has
            //a subtle issue in its addEventListener and script onload firings
            //that do not match the behavior of all other browsers with
            //addEventListener support, which fire the onload event for a
            //script right after the script execution. See:
            //https://connect.microsoft.com/IE/feedback/details/648057/script-onload-event-is-not-fired-immediately-after-script-execution
            //UNFORTUNATELY Opera implements attachEvent but does not follow the script
            //script execution mode.
            if (node.attachEvent &&
                    //Check if node.attachEvent is artificially added by custom script or
                    //natively supported by browser
                    //read https://github.com/jrburke/requirejs/issues/187
                    //if we can NOT find [native code] then it must NOT natively supported.
                    //in IE8, node.attachEvent does not have toString()
                    //Note the test for "[native code" with no closing brace, see:
                    //https://github.com/jrburke/requirejs/issues/273
                    !(node.attachEvent.toString && node.attachEvent.toString().indexOf('[native code') < 0) &&
                    !isOpera) {
                //Probably IE. IE (at least 6-8) do not fire
                //script onload right after executing the script, so
                //we cannot tie the anonymous define call to a name.
                //However, IE reports the script as being in 'interactive'
                //readyState at the time of the define call.
                useInteractive = true;

                node.attachEvent('onreadystatechange', context.onScriptLoad);
                //It would be great to add an error handler here to catch
                //404s in IE9+. However, onreadystatechange will fire before
                //the error handler, so that does not help. If addEventListener
                //is used, then IE will fire error before load, but we cannot
                //use that pathway given the connect.microsoft.com issue
                //mentioned above about not doing the 'script execute,
                //then fire the script load event listener before execute
                //next script' that other browsers do.
                //Best hope: IE10 fixes the issues,
                //and then destroys all installs of IE 6-9.
                //node.attachEvent('onerror', context.onScriptError);
            } else {
                node.addEventListener('load', context.onScriptLoad, false);
                node.addEventListener('error', context.onScriptError, false);
            }
            node.src = url;

            //For some cache cases in IE 6-8, the script executes before the end
            //of the appendChild execution, so to tie an anonymous define
            //call to the module name (which is stored on the node), hold on
            //to a reference to this node, but clear after the DOM insertion.
            currentlyAddingScript = node;
            if (baseElement) {
                head.insertBefore(node, baseElement);
            } else {
                head.appendChild(node);
            }
            currentlyAddingScript = null;

            return node;
        } else if (isWebWorker) {
            try {
                //In a web worker, use importScripts. This is not a very
                //efficient use of importScripts, importScripts will block until
                //its script is downloaded and evaluated. However, if web workers
                //are in play, the expectation that a build has been done so that
                //only one script needs to be loaded anyway. This may need to be
                //reevaluated if other use cases become common.
                importScripts(url);

                //Account for anonymous modules
                context.completeLoad(moduleName);
            } catch (e) {
                context.onError(makeError('importscripts',
                                'importScripts failed for ' +
                                    moduleName + ' at ' + url,
                                e,
                                [moduleName]));
            }
        }
    };

    function getInteractiveScript() {
        if (interactiveScript && interactiveScript.readyState === 'interactive') {
            return interactiveScript;
        }

        eachReverse(scripts(), function (script) {
            if (script.readyState === 'interactive') {
                return (interactiveScript = script);
            }
        });
        return interactiveScript;
    }

    //Look for a data-main script attribute, which could also adjust the baseUrl.
    if (isBrowser && !cfg.skipDataMain) {
        //Figure out baseUrl. Get it from the script tag with require.js in it.
        eachReverse(scripts(), function (script) {
            //Set the 'head' where we can append children by
            //using the script's parent.
            if (!head) {
                head = script.parentNode;
            }

            //Look for a data-main attribute to set main script for the page
            //to load. If it is there, the path to data main becomes the
            //baseUrl, if it is not already set.
            dataMain = script.getAttribute('data-main');
            if (dataMain) {
                //Preserve dataMain in case it is a path (i.e. contains '?')
                mainScript = dataMain;

                //Set final baseUrl if there is not already an explicit one.
                if (!cfg.baseUrl) {
                    //Pull off the directory of data-main for use as the
                    //baseUrl.
                    src = mainScript.split('/');
                    mainScript = src.pop();
                    subPath = src.length ? src.join('/')  + '/' : './';

                    cfg.baseUrl = subPath;
                }

                //Strip off any trailing .js since mainScript is now
                //like a module name.
                mainScript = mainScript.replace(jsSuffixRegExp, '');

                 //If mainScript is still a path, fall back to dataMain
                if (req.jsExtRegExp.test(mainScript)) {
                    mainScript = dataMain;
                }

                //Put the data-main script in the files to load.
                cfg.deps = cfg.deps ? cfg.deps.concat(mainScript) : [mainScript];

                return true;
            }
        });
    }

    /**
     * The function that handles definitions of modules. Differs from
     * require() in that a string for the module should be the first argument,
     * and the function to execute after dependencies are loaded should
     * return a value to define the module corresponding to the first argument's
     * name.
     */
    define = function (name, deps, callback) {
        var node, context;

        //Allow for anonymous modules
        if (typeof name !== 'string') {
            //Adjust args appropriately
            callback = deps;
            deps = name;
            name = null;
        }

        //This module may not have dependencies
        if (!isArray(deps)) {
            callback = deps;
            deps = null;
        }

        //If no name, and callback is a function, then figure out if it a
        //CommonJS thing with dependencies.
        if (!deps && isFunction(callback)) {
            deps = [];
            //Remove comments from the callback string,
            //look for require calls, and pull them into the dependencies,
            //but only if there are function args.
            if (callback.length) {
                callback
                    .toString()
                    .replace(commentRegExp, '')
                    .replace(cjsRequireRegExp, function (match, dep) {
                        deps.push(dep);
                    });

                //May be a CommonJS thing even without require calls, but still
                //could use exports, and module. Avoid doing exports and module
                //work though if it just needs require.
                //REQUIRES the function to expect the CommonJS variables in the
                //order listed below.
                deps = (callback.length === 1 ? ['require'] : ['require', 'exports', 'module']).concat(deps);
            }
        }

        //If in IE 6-8 and hit an anonymous define() call, do the interactive
        //work.
        if (useInteractive) {
            node = currentlyAddingScript || getInteractiveScript();
            if (node) {
                if (!name) {
                    name = node.getAttribute('data-requiremodule');
                }
                context = contexts[node.getAttribute('data-requirecontext')];
            }
        }

        //Always save off evaluating the def call until the script onload handler.
        //This allows multiple modules to be in a file without prematurely
        //tracing dependencies, and allows for anonymous module support,
        //where the module name is not known until the script onload event
        //occurs. If no context, use the global queue, and get it processed
        //in the onscript load callback.
        (context ? context.defQueue : globalDefQueue).push([name, deps, callback]);
    };

    define.amd = {
        jQuery: true
    };


    /**
     * Executes the text. Normally just uses eval, but can be modified
     * to use a better, environment-specific call. Only used for transpiling
     * loader plugins, not for plain JS modules.
     * @param {String} text the text to execute/evaluate.
     */
    req.exec = function (text) {
        /*jslint evil: true */
        return eval(text);
    };

    //Set up with config info.
    req(cfg);
}(this));

define("requirejs", function(){});

/**
 * @license RequireJS text 2.0.10 Copyright (c) 2010-2012, The Dojo Foundation All Rights Reserved.
 * Available via the MIT or new BSD license.
 * see: http://github.com/requirejs/text for details
 */
/*jslint regexp: true */
/*global require, XMLHttpRequest, ActiveXObject,
  define, window, process, Packages,
  java, location, Components, FileUtils */

define('text',['module'], function (module) {
    

    var text, fs, Cc, Ci, xpcIsWindows,
        progIds = ['Msxml2.XMLHTTP', 'Microsoft.XMLHTTP', 'Msxml2.XMLHTTP.4.0'],
        xmlRegExp = /^\s*<\?xml(\s)+version=[\'\"](\d)*.(\d)*[\'\"](\s)*\?>/im,
        bodyRegExp = /<body[^>]*>\s*([\s\S]+)\s*<\/body>/im,
        hasLocation = typeof location !== 'undefined' && location.href,
        defaultProtocol = hasLocation && location.protocol && location.protocol.replace(/\:/, ''),
        defaultHostName = hasLocation && location.hostname,
        defaultPort = hasLocation && (location.port || undefined),
        buildMap = {},
        masterConfig = (module.config && module.config()) || {};

    text = {
        version: '2.0.10',

        strip: function (content) {
            //Strips <?xml ...?> declarations so that external SVG and XML
            //documents can be added to a document without worry. Also, if the string
            //is an HTML document, only the part inside the body tag is returned.
            if (content) {
                content = content.replace(xmlRegExp, "");
                var matches = content.match(bodyRegExp);
                if (matches) {
                    content = matches[1];
                }
            } else {
                content = "";
            }
            return content;
        },

        jsEscape: function (content) {
            return content.replace(/(['\\])/g, '\\$1')
                .replace(/[\f]/g, "\\f")
                .replace(/[\b]/g, "\\b")
                .replace(/[\n]/g, "\\n")
                .replace(/[\t]/g, "\\t")
                .replace(/[\r]/g, "\\r")
                .replace(/[\u2028]/g, "\\u2028")
                .replace(/[\u2029]/g, "\\u2029");
        },

        createXhr: masterConfig.createXhr || function () {
            //Would love to dump the ActiveX crap in here. Need IE 6 to die first.
            var xhr, i, progId;
            if (typeof XMLHttpRequest !== "undefined") {
                return new XMLHttpRequest();
            } else if (typeof ActiveXObject !== "undefined") {
                for (i = 0; i < 3; i += 1) {
                    progId = progIds[i];
                    try {
                        xhr = new ActiveXObject(progId);
                    } catch (e) {}

                    if (xhr) {
                        progIds = [progId];  // so faster next time
                        break;
                    }
                }
            }

            return xhr;
        },

        /**
         * Parses a resource name into its component parts. Resource names
         * look like: module/name.ext!strip, where the !strip part is
         * optional.
         * @param {String} name the resource name
         * @returns {Object} with properties "moduleName", "ext" and "strip"
         * where strip is a boolean.
         */
        parseName: function (name) {
            var modName, ext, temp,
                strip = false,
                index = name.indexOf("."),
                isRelative = name.indexOf('./') === 0 ||
                             name.indexOf('../') === 0;

            if (index !== -1 && (!isRelative || index > 1)) {
                modName = name.substring(0, index);
                ext = name.substring(index + 1, name.length);
            } else {
                modName = name;
            }

            temp = ext || modName;
            index = temp.indexOf("!");
            if (index !== -1) {
                //Pull off the strip arg.
                strip = temp.substring(index + 1) === "strip";
                temp = temp.substring(0, index);
                if (ext) {
                    ext = temp;
                } else {
                    modName = temp;
                }
            }

            return {
                moduleName: modName,
                ext: ext,
                strip: strip
            };
        },

        xdRegExp: /^((\w+)\:)?\/\/([^\/\\]+)/,

        /**
         * Is an URL on another domain. Only works for browser use, returns
         * false in non-browser environments. Only used to know if an
         * optimized .js version of a text resource should be loaded
         * instead.
         * @param {String} url
         * @returns Boolean
         */
        useXhr: function (url, protocol, hostname, port) {
            var uProtocol, uHostName, uPort,
                match = text.xdRegExp.exec(url);
            if (!match) {
                return true;
            }
            uProtocol = match[2];
            uHostName = match[3];

            uHostName = uHostName.split(':');
            uPort = uHostName[1];
            uHostName = uHostName[0];

            return (!uProtocol || uProtocol === protocol) &&
                   (!uHostName || uHostName.toLowerCase() === hostname.toLowerCase()) &&
                   ((!uPort && !uHostName) || uPort === port);
        },

        finishLoad: function (name, strip, content, onLoad) {
            content = strip ? text.strip(content) : content;
            if (masterConfig.isBuild) {
                buildMap[name] = content;
            }
            onLoad(content);
        },

        load: function (name, req, onLoad, config) {
            //Name has format: some.module.filext!strip
            //The strip part is optional.
            //if strip is present, then that means only get the string contents
            //inside a body tag in an HTML string. For XML/SVG content it means
            //removing the <?xml ...?> declarations so the content can be inserted
            //into the current doc without problems.

            // Do not bother with the work if a build and text will
            // not be inlined.
            if (config.isBuild && !config.inlineText) {
                onLoad();
                return;
            }

            masterConfig.isBuild = config.isBuild;

            var parsed = text.parseName(name),
                nonStripName = parsed.moduleName +
                    (parsed.ext ? '.' + parsed.ext : ''),
                url = req.toUrl(nonStripName),
                useXhr = (masterConfig.useXhr) ||
                         text.useXhr;

            // Do not load if it is an empty: url
            if (url.indexOf('empty:') === 0) {
                onLoad();
                return;
            }

            //Load the text. Use XHR if possible and in a browser.
            if (!hasLocation || useXhr(url, defaultProtocol, defaultHostName, defaultPort)) {
                text.get(url, function (content) {
                    text.finishLoad(name, parsed.strip, content, onLoad);
                }, function (err) {
                    if (onLoad.error) {
                        onLoad.error(err);
                    }
                });
            } else {
                //Need to fetch the resource across domains. Assume
                //the resource has been optimized into a JS module. Fetch
                //by the module name + extension, but do not include the
                //!strip part to avoid file system issues.
                req([nonStripName], function (content) {
                    text.finishLoad(parsed.moduleName + '.' + parsed.ext,
                                    parsed.strip, content, onLoad);
                });
            }
        },

        write: function (pluginName, moduleName, write, config) {
            if (buildMap.hasOwnProperty(moduleName)) {
                var content = text.jsEscape(buildMap[moduleName]);
                write.asModule(pluginName + "!" + moduleName,
                               "define(function () { return '" +
                                   content +
                               "';});\n");
            }
        },

        writeFile: function (pluginName, moduleName, req, write, config) {
            var parsed = text.parseName(moduleName),
                extPart = parsed.ext ? '.' + parsed.ext : '',
                nonStripName = parsed.moduleName + extPart,
                //Use a '.js' file name so that it indicates it is a
                //script that can be loaded across domains.
                fileName = req.toUrl(parsed.moduleName + extPart) + '.js';

            //Leverage own load() method to load plugin value, but only
            //write out values that do not have the strip argument,
            //to avoid any potential issues with ! in file names.
            text.load(nonStripName, req, function (value) {
                //Use own write() method to construct full module value.
                //But need to create shell that translates writeFile's
                //write() to the right interface.
                var textWrite = function (contents) {
                    return write(fileName, contents);
                };
                textWrite.asModule = function (moduleName, contents) {
                    return write.asModule(moduleName, fileName, contents);
                };

                text.write(pluginName, nonStripName, textWrite, config);
            }, config);
        }
    };

    if (masterConfig.env === 'node' || (!masterConfig.env &&
            typeof process !== "undefined" &&
            process.versions &&
            !!process.versions.node &&
            !process.versions['node-webkit'])) {
        //Using special require.nodeRequire, something added by r.js.
        fs = require.nodeRequire('fs');

        text.get = function (url, callback, errback) {
            try {
                var file = fs.readFileSync(url, 'utf8');
                //Remove BOM (Byte Mark Order) from utf8 files if it is there.
                if (file.indexOf('\uFEFF') === 0) {
                    file = file.substring(1);
                }
                callback(file);
            } catch (e) {
                errback(e);
            }
        };
    } else if (masterConfig.env === 'xhr' || (!masterConfig.env &&
            text.createXhr())) {
        text.get = function (url, callback, errback, headers) {
            var xhr = text.createXhr(), header;
            xhr.open('GET', url, true);

            //Allow plugins direct access to xhr headers
            if (headers) {
                for (header in headers) {
                    if (headers.hasOwnProperty(header)) {
                        xhr.setRequestHeader(header.toLowerCase(), headers[header]);
                    }
                }
            }

            //Allow overrides specified in config
            if (masterConfig.onXhr) {
                masterConfig.onXhr(xhr, url);
            }

            xhr.onreadystatechange = function (evt) {
                var status, err;
                //Do not explicitly handle errors, those should be
                //visible via console output in the browser.
                if (xhr.readyState === 4) {
                    status = xhr.status;
                    if (status > 399 && status < 600) {
                        //An http 4xx or 5xx error. Signal an error.
                        err = new Error(url + ' HTTP status: ' + status);
                        err.xhr = xhr;
                        errback(err);
                    } else {
                        callback(xhr.responseText);
                    }

                    if (masterConfig.onXhrComplete) {
                        masterConfig.onXhrComplete(xhr, url);
                    }
                }
            };
            xhr.send(null);
        };
    } else if (masterConfig.env === 'rhino' || (!masterConfig.env &&
            typeof Packages !== 'undefined' && typeof java !== 'undefined')) {
        //Why Java, why is this so awkward?
        text.get = function (url, callback) {
            var stringBuffer, line,
                encoding = "utf-8",
                file = new java.io.File(url),
                lineSeparator = java.lang.System.getProperty("line.separator"),
                input = new java.io.BufferedReader(new java.io.InputStreamReader(new java.io.FileInputStream(file), encoding)),
                content = '';
            try {
                stringBuffer = new java.lang.StringBuffer();
                line = input.readLine();

                // Byte Order Mark (BOM) - The Unicode Standard, version 3.0, page 324
                // http://www.unicode.org/faq/utf_bom.html

                // Note that when we use utf-8, the BOM should appear as "EF BB BF", but it doesn't due to this bug in the JDK:
                // http://bugs.sun.com/bugdatabase/view_bug.do?bug_id=4508058
                if (line && line.length() && line.charAt(0) === 0xfeff) {
                    // Eat the BOM, since we've already found the encoding on this file,
                    // and we plan to concatenating this buffer with others; the BOM should
                    // only appear at the top of a file.
                    line = line.substring(1);
                }

                if (line !== null) {
                    stringBuffer.append(line);
                }

                while ((line = input.readLine()) !== null) {
                    stringBuffer.append(lineSeparator);
                    stringBuffer.append(line);
                }
                //Make sure we return a JavaScript string and not a Java string.
                content = String(stringBuffer.toString()); //String
            } finally {
                input.close();
            }
            callback(content);
        };
    } else if (masterConfig.env === 'xpconnect' || (!masterConfig.env &&
            typeof Components !== 'undefined' && Components.classes &&
            Components.interfaces)) {
        //Avert your gaze!
        Cc = Components.classes,
        Ci = Components.interfaces;
        Components.utils['import']('resource://gre/modules/FileUtils.jsm');
        xpcIsWindows = ('@mozilla.org/windows-registry-key;1' in Cc);

        text.get = function (url, callback) {
            var inStream, convertStream, fileObj,
                readData = {};

            if (xpcIsWindows) {
                url = url.replace(/\//g, '\\');
            }

            fileObj = new FileUtils.File(url);

            //XPCOM, you so crazy
            try {
                inStream = Cc['@mozilla.org/network/file-input-stream;1']
                           .createInstance(Ci.nsIFileInputStream);
                inStream.init(fileObj, 1, 0, false);

                convertStream = Cc['@mozilla.org/intl/converter-input-stream;1']
                                .createInstance(Ci.nsIConverterInputStream);
                convertStream.init(inStream, "utf-8", inStream.available(),
                Ci.nsIConverterInputStream.DEFAULT_REPLACEMENT_CHARACTER);

                convertStream.readString(inStream.available(), readData);
                convertStream.close();
                inStream.close();
                callback(readData.value);
            } catch (e) {
                throw new Error((fileObj && fileObj.path || '') + ': ' + e);
            }
        };
    }
    return text;
});

/*! jQuery v1.9.1 | (c) 2005, 2012 jQuery Foundation, Inc. | jquery.org/license
//@ sourceMappingURL=jquery.min.map
*/(function(e,t){var n,r,i=typeof t,o=e.document,a=e.location,s=e.jQuery,u=e.$,l={},c=[],p="1.9.1",f=c.concat,d=c.push,h=c.slice,g=c.indexOf,m=l.toString,y=l.hasOwnProperty,v=p.trim,b=function(e,t){return new b.fn.init(e,t,r)},x=/[+-]?(?:\d*\.|)\d+(?:[eE][+-]?\d+|)/.source,w=/\S+/g,T=/^[\s\uFEFF\xA0]+|[\s\uFEFF\xA0]+$/g,N=/^(?:(<[\w\W]+>)[^>]*|#([\w-]*))$/,C=/^<(\w+)\s*\/?>(?:<\/\1>|)$/,k=/^[\],:{}\s]*$/,E=/(?:^|:|,)(?:\s*\[)+/g,S=/\\(?:["\\\/bfnrt]|u[\da-fA-F]{4})/g,A=/"[^"\\\r\n]*"|true|false|null|-?(?:\d+\.|)\d+(?:[eE][+-]?\d+|)/g,j=/^-ms-/,D=/-([\da-z])/gi,L=function(e,t){return t.toUpperCase()},H=function(e){(o.addEventListener||"load"===e.type||"complete"===o.readyState)&&(q(),b.ready())},q=function(){o.addEventListener?(o.removeEventListener("DOMContentLoaded",H,!1),e.removeEventListener("load",H,!1)):(o.detachEvent("onreadystatechange",H),e.detachEvent("onload",H))};b.fn=b.prototype={jquery:p,constructor:b,init:function(e,n,r){var i,a;if(!e)return this;if("string"==typeof e){if(i="<"===e.charAt(0)&&">"===e.charAt(e.length-1)&&e.length>=3?[null,e,null]:N.exec(e),!i||!i[1]&&n)return!n||n.jquery?(n||r).find(e):this.constructor(n).find(e);if(i[1]){if(n=n instanceof b?n[0]:n,b.merge(this,b.parseHTML(i[1],n&&n.nodeType?n.ownerDocument||n:o,!0)),C.test(i[1])&&b.isPlainObject(n))for(i in n)b.isFunction(this[i])?this[i](n[i]):this.attr(i,n[i]);return this}if(a=o.getElementById(i[2]),a&&a.parentNode){if(a.id!==i[2])return r.find(e);this.length=1,this[0]=a}return this.context=o,this.selector=e,this}return e.nodeType?(this.context=this[0]=e,this.length=1,this):b.isFunction(e)?r.ready(e):(e.selector!==t&&(this.selector=e.selector,this.context=e.context),b.makeArray(e,this))},selector:"",length:0,size:function(){return this.length},toArray:function(){return h.call(this)},get:function(e){return null==e?this.toArray():0>e?this[this.length+e]:this[e]},pushStack:function(e){var t=b.merge(this.constructor(),e);return t.prevObject=this,t.context=this.context,t},each:function(e,t){return b.each(this,e,t)},ready:function(e){return b.ready.promise().done(e),this},slice:function(){return this.pushStack(h.apply(this,arguments))},first:function(){return this.eq(0)},last:function(){return this.eq(-1)},eq:function(e){var t=this.length,n=+e+(0>e?t:0);return this.pushStack(n>=0&&t>n?[this[n]]:[])},map:function(e){return this.pushStack(b.map(this,function(t,n){return e.call(t,n,t)}))},end:function(){return this.prevObject||this.constructor(null)},push:d,sort:[].sort,splice:[].splice},b.fn.init.prototype=b.fn,b.extend=b.fn.extend=function(){var e,n,r,i,o,a,s=arguments[0]||{},u=1,l=arguments.length,c=!1;for("boolean"==typeof s&&(c=s,s=arguments[1]||{},u=2),"object"==typeof s||b.isFunction(s)||(s={}),l===u&&(s=this,--u);l>u;u++)if(null!=(o=arguments[u]))for(i in o)e=s[i],r=o[i],s!==r&&(c&&r&&(b.isPlainObject(r)||(n=b.isArray(r)))?(n?(n=!1,a=e&&b.isArray(e)?e:[]):a=e&&b.isPlainObject(e)?e:{},s[i]=b.extend(c,a,r)):r!==t&&(s[i]=r));return s},b.extend({noConflict:function(t){return e.$===b&&(e.$=u),t&&e.jQuery===b&&(e.jQuery=s),b},isReady:!1,readyWait:1,holdReady:function(e){e?b.readyWait++:b.ready(!0)},ready:function(e){if(e===!0?!--b.readyWait:!b.isReady){if(!o.body)return setTimeout(b.ready);b.isReady=!0,e!==!0&&--b.readyWait>0||(n.resolveWith(o,[b]),b.fn.trigger&&b(o).trigger("ready").off("ready"))}},isFunction:function(e){return"function"===b.type(e)},isArray:Array.isArray||function(e){return"array"===b.type(e)},isWindow:function(e){return null!=e&&e==e.window},isNumeric:function(e){return!isNaN(parseFloat(e))&&isFinite(e)},type:function(e){return null==e?e+"":"object"==typeof e||"function"==typeof e?l[m.call(e)]||"object":typeof e},isPlainObject:function(e){if(!e||"object"!==b.type(e)||e.nodeType||b.isWindow(e))return!1;try{if(e.constructor&&!y.call(e,"constructor")&&!y.call(e.constructor.prototype,"isPrototypeOf"))return!1}catch(n){return!1}var r;for(r in e);return r===t||y.call(e,r)},isEmptyObject:function(e){var t;for(t in e)return!1;return!0},error:function(e){throw Error(e)},parseHTML:function(e,t,n){if(!e||"string"!=typeof e)return null;"boolean"==typeof t&&(n=t,t=!1),t=t||o;var r=C.exec(e),i=!n&&[];return r?[t.createElement(r[1])]:(r=b.buildFragment([e],t,i),i&&b(i).remove(),b.merge([],r.childNodes))},parseJSON:function(n){return e.JSON&&e.JSON.parse?e.JSON.parse(n):null===n?n:"string"==typeof n&&(n=b.trim(n),n&&k.test(n.replace(S,"@").replace(A,"]").replace(E,"")))?Function("return "+n)():(b.error("Invalid JSON: "+n),t)},parseXML:function(n){var r,i;if(!n||"string"!=typeof n)return null;try{e.DOMParser?(i=new DOMParser,r=i.parseFromString(n,"text/xml")):(r=new ActiveXObject("Microsoft.XMLDOM"),r.async="false",r.loadXML(n))}catch(o){r=t}return r&&r.documentElement&&!r.getElementsByTagName("parsererror").length||b.error("Invalid XML: "+n),r},noop:function(){},globalEval:function(t){t&&b.trim(t)&&(e.execScript||function(t){e.eval.call(e,t)})(t)},camelCase:function(e){return e.replace(j,"ms-").replace(D,L)},nodeName:function(e,t){return e.nodeName&&e.nodeName.toLowerCase()===t.toLowerCase()},each:function(e,t,n){var r,i=0,o=e.length,a=M(e);if(n){if(a){for(;o>i;i++)if(r=t.apply(e[i],n),r===!1)break}else for(i in e)if(r=t.apply(e[i],n),r===!1)break}else if(a){for(;o>i;i++)if(r=t.call(e[i],i,e[i]),r===!1)break}else for(i in e)if(r=t.call(e[i],i,e[i]),r===!1)break;return e},trim:v&&!v.call("\ufeff\u00a0")?function(e){return null==e?"":v.call(e)}:function(e){return null==e?"":(e+"").replace(T,"")},makeArray:function(e,t){var n=t||[];return null!=e&&(M(Object(e))?b.merge(n,"string"==typeof e?[e]:e):d.call(n,e)),n},inArray:function(e,t,n){var r;if(t){if(g)return g.call(t,e,n);for(r=t.length,n=n?0>n?Math.max(0,r+n):n:0;r>n;n++)if(n in t&&t[n]===e)return n}return-1},merge:function(e,n){var r=n.length,i=e.length,o=0;if("number"==typeof r)for(;r>o;o++)e[i++]=n[o];else while(n[o]!==t)e[i++]=n[o++];return e.length=i,e},grep:function(e,t,n){var r,i=[],o=0,a=e.length;for(n=!!n;a>o;o++)r=!!t(e[o],o),n!==r&&i.push(e[o]);return i},map:function(e,t,n){var r,i=0,o=e.length,a=M(e),s=[];if(a)for(;o>i;i++)r=t(e[i],i,n),null!=r&&(s[s.length]=r);else for(i in e)r=t(e[i],i,n),null!=r&&(s[s.length]=r);return f.apply([],s)},guid:1,proxy:function(e,n){var r,i,o;return"string"==typeof n&&(o=e[n],n=e,e=o),b.isFunction(e)?(r=h.call(arguments,2),i=function(){return e.apply(n||this,r.concat(h.call(arguments)))},i.guid=e.guid=e.guid||b.guid++,i):t},access:function(e,n,r,i,o,a,s){var u=0,l=e.length,c=null==r;if("object"===b.type(r)){o=!0;for(u in r)b.access(e,n,u,r[u],!0,a,s)}else if(i!==t&&(o=!0,b.isFunction(i)||(s=!0),c&&(s?(n.call(e,i),n=null):(c=n,n=function(e,t,n){return c.call(b(e),n)})),n))for(;l>u;u++)n(e[u],r,s?i:i.call(e[u],u,n(e[u],r)));return o?e:c?n.call(e):l?n(e[0],r):a},now:function(){return(new Date).getTime()}}),b.ready.promise=function(t){if(!n)if(n=b.Deferred(),"complete"===o.readyState)setTimeout(b.ready);else if(o.addEventListener)o.addEventListener("DOMContentLoaded",H,!1),e.addEventListener("load",H,!1);else{o.attachEvent("onreadystatechange",H),e.attachEvent("onload",H);var r=!1;try{r=null==e.frameElement&&o.documentElement}catch(i){}r&&r.doScroll&&function a(){if(!b.isReady){try{r.doScroll("left")}catch(e){return setTimeout(a,50)}q(),b.ready()}}()}return n.promise(t)},b.each("Boolean Number String Function Array Date RegExp Object Error".split(" "),function(e,t){l["[object "+t+"]"]=t.toLowerCase()});function M(e){var t=e.length,n=b.type(e);return b.isWindow(e)?!1:1===e.nodeType&&t?!0:"array"===n||"function"!==n&&(0===t||"number"==typeof t&&t>0&&t-1 in e)}r=b(o);var _={};function F(e){var t=_[e]={};return b.each(e.match(w)||[],function(e,n){t[n]=!0}),t}b.Callbacks=function(e){e="string"==typeof e?_[e]||F(e):b.extend({},e);var n,r,i,o,a,s,u=[],l=!e.once&&[],c=function(t){for(r=e.memory&&t,i=!0,a=s||0,s=0,o=u.length,n=!0;u&&o>a;a++)if(u[a].apply(t[0],t[1])===!1&&e.stopOnFalse){r=!1;break}n=!1,u&&(l?l.length&&c(l.shift()):r?u=[]:p.disable())},p={add:function(){if(u){var t=u.length;(function i(t){b.each(t,function(t,n){var r=b.type(n);"function"===r?e.unique&&p.has(n)||u.push(n):n&&n.length&&"string"!==r&&i(n)})})(arguments),n?o=u.length:r&&(s=t,c(r))}return this},remove:function(){return u&&b.each(arguments,function(e,t){var r;while((r=b.inArray(t,u,r))>-1)u.splice(r,1),n&&(o>=r&&o--,a>=r&&a--)}),this},has:function(e){return e?b.inArray(e,u)>-1:!(!u||!u.length)},empty:function(){return u=[],this},disable:function(){return u=l=r=t,this},disabled:function(){return!u},lock:function(){return l=t,r||p.disable(),this},locked:function(){return!l},fireWith:function(e,t){return t=t||[],t=[e,t.slice?t.slice():t],!u||i&&!l||(n?l.push(t):c(t)),this},fire:function(){return p.fireWith(this,arguments),this},fired:function(){return!!i}};return p},b.extend({Deferred:function(e){var t=[["resolve","done",b.Callbacks("once memory"),"resolved"],["reject","fail",b.Callbacks("once memory"),"rejected"],["notify","progress",b.Callbacks("memory")]],n="pending",r={state:function(){return n},always:function(){return i.done(arguments).fail(arguments),this},then:function(){var e=arguments;return b.Deferred(function(n){b.each(t,function(t,o){var a=o[0],s=b.isFunction(e[t])&&e[t];i[o[1]](function(){var e=s&&s.apply(this,arguments);e&&b.isFunction(e.promise)?e.promise().done(n.resolve).fail(n.reject).progress(n.notify):n[a+"With"](this===r?n.promise():this,s?[e]:arguments)})}),e=null}).promise()},promise:function(e){return null!=e?b.extend(e,r):r}},i={};return r.pipe=r.then,b.each(t,function(e,o){var a=o[2],s=o[3];r[o[1]]=a.add,s&&a.add(function(){n=s},t[1^e][2].disable,t[2][2].lock),i[o[0]]=function(){return i[o[0]+"With"](this===i?r:this,arguments),this},i[o[0]+"With"]=a.fireWith}),r.promise(i),e&&e.call(i,i),i},when:function(e){var t=0,n=h.call(arguments),r=n.length,i=1!==r||e&&b.isFunction(e.promise)?r:0,o=1===i?e:b.Deferred(),a=function(e,t,n){return function(r){t[e]=this,n[e]=arguments.length>1?h.call(arguments):r,n===s?o.notifyWith(t,n):--i||o.resolveWith(t,n)}},s,u,l;if(r>1)for(s=Array(r),u=Array(r),l=Array(r);r>t;t++)n[t]&&b.isFunction(n[t].promise)?n[t].promise().done(a(t,l,n)).fail(o.reject).progress(a(t,u,s)):--i;return i||o.resolveWith(l,n),o.promise()}}),b.support=function(){var t,n,r,a,s,u,l,c,p,f,d=o.createElement("div");if(d.setAttribute("className","t"),d.innerHTML="  <link/><table></table><a href='/a'>a</a><input type='checkbox'/>",n=d.getElementsByTagName("*"),r=d.getElementsByTagName("a")[0],!n||!r||!n.length)return{};s=o.createElement("select"),l=s.appendChild(o.createElement("option")),a=d.getElementsByTagName("input")[0],r.style.cssText="top:1px;float:left;opacity:.5",t={getSetAttribute:"t"!==d.className,leadingWhitespace:3===d.firstChild.nodeType,tbody:!d.getElementsByTagName("tbody").length,htmlSerialize:!!d.getElementsByTagName("link").length,style:/top/.test(r.getAttribute("style")),hrefNormalized:"/a"===r.getAttribute("href"),opacity:/^0.5/.test(r.style.opacity),cssFloat:!!r.style.cssFloat,checkOn:!!a.value,optSelected:l.selected,enctype:!!o.createElement("form").enctype,html5Clone:"<:nav></:nav>"!==o.createElement("nav").cloneNode(!0).outerHTML,boxModel:"CSS1Compat"===o.compatMode,deleteExpando:!0,noCloneEvent:!0,inlineBlockNeedsLayout:!1,shrinkWrapBlocks:!1,reliableMarginRight:!0,boxSizingReliable:!0,pixelPosition:!1},a.checked=!0,t.noCloneChecked=a.cloneNode(!0).checked,s.disabled=!0,t.optDisabled=!l.disabled;try{delete d.test}catch(h){t.deleteExpando=!1}a=o.createElement("input"),a.setAttribute("value",""),t.input=""===a.getAttribute("value"),a.value="t",a.setAttribute("type","radio"),t.radioValue="t"===a.value,a.setAttribute("checked","t"),a.setAttribute("name","t"),u=o.createDocumentFragment(),u.appendChild(a),t.appendChecked=a.checked,t.checkClone=u.cloneNode(!0).cloneNode(!0).lastChild.checked,d.attachEvent&&(d.attachEvent("onclick",function(){t.noCloneEvent=!1}),d.cloneNode(!0).click());for(f in{submit:!0,change:!0,focusin:!0})d.setAttribute(c="on"+f,"t"),t[f+"Bubbles"]=c in e||d.attributes[c].expando===!1;return d.style.backgroundClip="content-box",d.cloneNode(!0).style.backgroundClip="",t.clearCloneStyle="content-box"===d.style.backgroundClip,b(function(){var n,r,a,s="padding:0;margin:0;border:0;display:block;box-sizing:content-box;-moz-box-sizing:content-box;-webkit-box-sizing:content-box;",u=o.getElementsByTagName("body")[0];u&&(n=o.createElement("div"),n.style.cssText="border:0;width:0;height:0;position:absolute;top:0;left:-9999px;margin-top:1px",u.appendChild(n).appendChild(d),d.innerHTML="<table><tr><td></td><td>t</td></tr></table>",a=d.getElementsByTagName("td"),a[0].style.cssText="padding:0;margin:0;border:0;display:none",p=0===a[0].offsetHeight,a[0].style.display="",a[1].style.display="none",t.reliableHiddenOffsets=p&&0===a[0].offsetHeight,d.innerHTML="",d.style.cssText="box-sizing:border-box;-moz-box-sizing:border-box;-webkit-box-sizing:border-box;padding:1px;border:1px;display:block;width:4px;margin-top:1%;position:absolute;top:1%;",t.boxSizing=4===d.offsetWidth,t.doesNotIncludeMarginInBodyOffset=1!==u.offsetTop,e.getComputedStyle&&(t.pixelPosition="1%"!==(e.getComputedStyle(d,null)||{}).top,t.boxSizingReliable="4px"===(e.getComputedStyle(d,null)||{width:"4px"}).width,r=d.appendChild(o.createElement("div")),r.style.cssText=d.style.cssText=s,r.style.marginRight=r.style.width="0",d.style.width="1px",t.reliableMarginRight=!parseFloat((e.getComputedStyle(r,null)||{}).marginRight)),typeof d.style.zoom!==i&&(d.innerHTML="",d.style.cssText=s+"width:1px;padding:1px;display:inline;zoom:1",t.inlineBlockNeedsLayout=3===d.offsetWidth,d.style.display="block",d.innerHTML="<div></div>",d.firstChild.style.width="5px",t.shrinkWrapBlocks=3!==d.offsetWidth,t.inlineBlockNeedsLayout&&(u.style.zoom=1)),u.removeChild(n),n=d=a=r=null)}),n=s=u=l=r=a=null,t}();var O=/(?:\{[\s\S]*\}|\[[\s\S]*\])$/,B=/([A-Z])/g;function P(e,n,r,i){if(b.acceptData(e)){var o,a,s=b.expando,u="string"==typeof n,l=e.nodeType,p=l?b.cache:e,f=l?e[s]:e[s]&&s;if(f&&p[f]&&(i||p[f].data)||!u||r!==t)return f||(l?e[s]=f=c.pop()||b.guid++:f=s),p[f]||(p[f]={},l||(p[f].toJSON=b.noop)),("object"==typeof n||"function"==typeof n)&&(i?p[f]=b.extend(p[f],n):p[f].data=b.extend(p[f].data,n)),o=p[f],i||(o.data||(o.data={}),o=o.data),r!==t&&(o[b.camelCase(n)]=r),u?(a=o[n],null==a&&(a=o[b.camelCase(n)])):a=o,a}}function R(e,t,n){if(b.acceptData(e)){var r,i,o,a=e.nodeType,s=a?b.cache:e,u=a?e[b.expando]:b.expando;if(s[u]){if(t&&(o=n?s[u]:s[u].data)){b.isArray(t)?t=t.concat(b.map(t,b.camelCase)):t in o?t=[t]:(t=b.camelCase(t),t=t in o?[t]:t.split(" "));for(r=0,i=t.length;i>r;r++)delete o[t[r]];if(!(n?$:b.isEmptyObject)(o))return}(n||(delete s[u].data,$(s[u])))&&(a?b.cleanData([e],!0):b.support.deleteExpando||s!=s.window?delete s[u]:s[u]=null)}}}b.extend({cache:{},expando:"jQuery"+(p+Math.random()).replace(/\D/g,""),noData:{embed:!0,object:"clsid:D27CDB6E-AE6D-11cf-96B8-444553540000",applet:!0},hasData:function(e){return e=e.nodeType?b.cache[e[b.expando]]:e[b.expando],!!e&&!$(e)},data:function(e,t,n){return P(e,t,n)},removeData:function(e,t){return R(e,t)},_data:function(e,t,n){return P(e,t,n,!0)},_removeData:function(e,t){return R(e,t,!0)},acceptData:function(e){if(e.nodeType&&1!==e.nodeType&&9!==e.nodeType)return!1;var t=e.nodeName&&b.noData[e.nodeName.toLowerCase()];return!t||t!==!0&&e.getAttribute("classid")===t}}),b.fn.extend({data:function(e,n){var r,i,o=this[0],a=0,s=null;if(e===t){if(this.length&&(s=b.data(o),1===o.nodeType&&!b._data(o,"parsedAttrs"))){for(r=o.attributes;r.length>a;a++)i=r[a].name,i.indexOf("data-")||(i=b.camelCase(i.slice(5)),W(o,i,s[i]));b._data(o,"parsedAttrs",!0)}return s}return"object"==typeof e?this.each(function(){b.data(this,e)}):b.access(this,function(n){return n===t?o?W(o,e,b.data(o,e)):null:(this.each(function(){b.data(this,e,n)}),t)},null,n,arguments.length>1,null,!0)},removeData:function(e){return this.each(function(){b.removeData(this,e)})}});function W(e,n,r){if(r===t&&1===e.nodeType){var i="data-"+n.replace(B,"-$1").toLowerCase();if(r=e.getAttribute(i),"string"==typeof r){try{r="true"===r?!0:"false"===r?!1:"null"===r?null:+r+""===r?+r:O.test(r)?b.parseJSON(r):r}catch(o){}b.data(e,n,r)}else r=t}return r}function $(e){var t;for(t in e)if(("data"!==t||!b.isEmptyObject(e[t]))&&"toJSON"!==t)return!1;return!0}b.extend({queue:function(e,n,r){var i;return e?(n=(n||"fx")+"queue",i=b._data(e,n),r&&(!i||b.isArray(r)?i=b._data(e,n,b.makeArray(r)):i.push(r)),i||[]):t},dequeue:function(e,t){t=t||"fx";var n=b.queue(e,t),r=n.length,i=n.shift(),o=b._queueHooks(e,t),a=function(){b.dequeue(e,t)};"inprogress"===i&&(i=n.shift(),r--),o.cur=i,i&&("fx"===t&&n.unshift("inprogress"),delete o.stop,i.call(e,a,o)),!r&&o&&o.empty.fire()},_queueHooks:function(e,t){var n=t+"queueHooks";return b._data(e,n)||b._data(e,n,{empty:b.Callbacks("once memory").add(function(){b._removeData(e,t+"queue"),b._removeData(e,n)})})}}),b.fn.extend({queue:function(e,n){var r=2;return"string"!=typeof e&&(n=e,e="fx",r--),r>arguments.length?b.queue(this[0],e):n===t?this:this.each(function(){var t=b.queue(this,e,n);b._queueHooks(this,e),"fx"===e&&"inprogress"!==t[0]&&b.dequeue(this,e)})},dequeue:function(e){return this.each(function(){b.dequeue(this,e)})},delay:function(e,t){return e=b.fx?b.fx.speeds[e]||e:e,t=t||"fx",this.queue(t,function(t,n){var r=setTimeout(t,e);n.stop=function(){clearTimeout(r)}})},clearQueue:function(e){return this.queue(e||"fx",[])},promise:function(e,n){var r,i=1,o=b.Deferred(),a=this,s=this.length,u=function(){--i||o.resolveWith(a,[a])};"string"!=typeof e&&(n=e,e=t),e=e||"fx";while(s--)r=b._data(a[s],e+"queueHooks"),r&&r.empty&&(i++,r.empty.add(u));return u(),o.promise(n)}});var I,z,X=/[\t\r\n]/g,U=/\r/g,V=/^(?:input|select|textarea|button|object)$/i,Y=/^(?:a|area)$/i,J=/^(?:checked|selected|autofocus|autoplay|async|controls|defer|disabled|hidden|loop|multiple|open|readonly|required|scoped)$/i,G=/^(?:checked|selected)$/i,Q=b.support.getSetAttribute,K=b.support.input;b.fn.extend({attr:function(e,t){return b.access(this,b.attr,e,t,arguments.length>1)},removeAttr:function(e){return this.each(function(){b.removeAttr(this,e)})},prop:function(e,t){return b.access(this,b.prop,e,t,arguments.length>1)},removeProp:function(e){return e=b.propFix[e]||e,this.each(function(){try{this[e]=t,delete this[e]}catch(n){}})},addClass:function(e){var t,n,r,i,o,a=0,s=this.length,u="string"==typeof e&&e;if(b.isFunction(e))return this.each(function(t){b(this).addClass(e.call(this,t,this.className))});if(u)for(t=(e||"").match(w)||[];s>a;a++)if(n=this[a],r=1===n.nodeType&&(n.className?(" "+n.className+" ").replace(X," "):" ")){o=0;while(i=t[o++])0>r.indexOf(" "+i+" ")&&(r+=i+" ");n.className=b.trim(r)}return this},removeClass:function(e){var t,n,r,i,o,a=0,s=this.length,u=0===arguments.length||"string"==typeof e&&e;if(b.isFunction(e))return this.each(function(t){b(this).removeClass(e.call(this,t,this.className))});if(u)for(t=(e||"").match(w)||[];s>a;a++)if(n=this[a],r=1===n.nodeType&&(n.className?(" "+n.className+" ").replace(X," "):"")){o=0;while(i=t[o++])while(r.indexOf(" "+i+" ")>=0)r=r.replace(" "+i+" "," ");n.className=e?b.trim(r):""}return this},toggleClass:function(e,t){var n=typeof e,r="boolean"==typeof t;return b.isFunction(e)?this.each(function(n){b(this).toggleClass(e.call(this,n,this.className,t),t)}):this.each(function(){if("string"===n){var o,a=0,s=b(this),u=t,l=e.match(w)||[];while(o=l[a++])u=r?u:!s.hasClass(o),s[u?"addClass":"removeClass"](o)}else(n===i||"boolean"===n)&&(this.className&&b._data(this,"__className__",this.className),this.className=this.className||e===!1?"":b._data(this,"__className__")||"")})},hasClass:function(e){var t=" "+e+" ",n=0,r=this.length;for(;r>n;n++)if(1===this[n].nodeType&&(" "+this[n].className+" ").replace(X," ").indexOf(t)>=0)return!0;return!1},val:function(e){var n,r,i,o=this[0];{if(arguments.length)return i=b.isFunction(e),this.each(function(n){var o,a=b(this);1===this.nodeType&&(o=i?e.call(this,n,a.val()):e,null==o?o="":"number"==typeof o?o+="":b.isArray(o)&&(o=b.map(o,function(e){return null==e?"":e+""})),r=b.valHooks[this.type]||b.valHooks[this.nodeName.toLowerCase()],r&&"set"in r&&r.set(this,o,"value")!==t||(this.value=o))});if(o)return r=b.valHooks[o.type]||b.valHooks[o.nodeName.toLowerCase()],r&&"get"in r&&(n=r.get(o,"value"))!==t?n:(n=o.value,"string"==typeof n?n.replace(U,""):null==n?"":n)}}}),b.extend({valHooks:{option:{get:function(e){var t=e.attributes.value;return!t||t.specified?e.value:e.text}},select:{get:function(e){var t,n,r=e.options,i=e.selectedIndex,o="select-one"===e.type||0>i,a=o?null:[],s=o?i+1:r.length,u=0>i?s:o?i:0;for(;s>u;u++)if(n=r[u],!(!n.selected&&u!==i||(b.support.optDisabled?n.disabled:null!==n.getAttribute("disabled"))||n.parentNode.disabled&&b.nodeName(n.parentNode,"optgroup"))){if(t=b(n).val(),o)return t;a.push(t)}return a},set:function(e,t){var n=b.makeArray(t);return b(e).find("option").each(function(){this.selected=b.inArray(b(this).val(),n)>=0}),n.length||(e.selectedIndex=-1),n}}},attr:function(e,n,r){var o,a,s,u=e.nodeType;if(e&&3!==u&&8!==u&&2!==u)return typeof e.getAttribute===i?b.prop(e,n,r):(a=1!==u||!b.isXMLDoc(e),a&&(n=n.toLowerCase(),o=b.attrHooks[n]||(J.test(n)?z:I)),r===t?o&&a&&"get"in o&&null!==(s=o.get(e,n))?s:(typeof e.getAttribute!==i&&(s=e.getAttribute(n)),null==s?t:s):null!==r?o&&a&&"set"in o&&(s=o.set(e,r,n))!==t?s:(e.setAttribute(n,r+""),r):(b.removeAttr(e,n),t))},removeAttr:function(e,t){var n,r,i=0,o=t&&t.match(w);if(o&&1===e.nodeType)while(n=o[i++])r=b.propFix[n]||n,J.test(n)?!Q&&G.test(n)?e[b.camelCase("default-"+n)]=e[r]=!1:e[r]=!1:b.attr(e,n,""),e.removeAttribute(Q?n:r)},attrHooks:{type:{set:function(e,t){if(!b.support.radioValue&&"radio"===t&&b.nodeName(e,"input")){var n=e.value;return e.setAttribute("type",t),n&&(e.value=n),t}}}},propFix:{tabindex:"tabIndex",readonly:"readOnly","for":"htmlFor","class":"className",maxlength:"maxLength",cellspacing:"cellSpacing",cellpadding:"cellPadding",rowspan:"rowSpan",colspan:"colSpan",usemap:"useMap",frameborder:"frameBorder",contenteditable:"contentEditable"},prop:function(e,n,r){var i,o,a,s=e.nodeType;if(e&&3!==s&&8!==s&&2!==s)return a=1!==s||!b.isXMLDoc(e),a&&(n=b.propFix[n]||n,o=b.propHooks[n]),r!==t?o&&"set"in o&&(i=o.set(e,r,n))!==t?i:e[n]=r:o&&"get"in o&&null!==(i=o.get(e,n))?i:e[n]},propHooks:{tabIndex:{get:function(e){var n=e.getAttributeNode("tabindex");return n&&n.specified?parseInt(n.value,10):V.test(e.nodeName)||Y.test(e.nodeName)&&e.href?0:t}}}}),z={get:function(e,n){var r=b.prop(e,n),i="boolean"==typeof r&&e.getAttribute(n),o="boolean"==typeof r?K&&Q?null!=i:G.test(n)?e[b.camelCase("default-"+n)]:!!i:e.getAttributeNode(n);return o&&o.value!==!1?n.toLowerCase():t},set:function(e,t,n){return t===!1?b.removeAttr(e,n):K&&Q||!G.test(n)?e.setAttribute(!Q&&b.propFix[n]||n,n):e[b.camelCase("default-"+n)]=e[n]=!0,n}},K&&Q||(b.attrHooks.value={get:function(e,n){var r=e.getAttributeNode(n);return b.nodeName(e,"input")?e.defaultValue:r&&r.specified?r.value:t},set:function(e,n,r){return b.nodeName(e,"input")?(e.defaultValue=n,t):I&&I.set(e,n,r)}}),Q||(I=b.valHooks.button={get:function(e,n){var r=e.getAttributeNode(n);return r&&("id"===n||"name"===n||"coords"===n?""!==r.value:r.specified)?r.value:t},set:function(e,n,r){var i=e.getAttributeNode(r);return i||e.setAttributeNode(i=e.ownerDocument.createAttribute(r)),i.value=n+="","value"===r||n===e.getAttribute(r)?n:t}},b.attrHooks.contenteditable={get:I.get,set:function(e,t,n){I.set(e,""===t?!1:t,n)}},b.each(["width","height"],function(e,n){b.attrHooks[n]=b.extend(b.attrHooks[n],{set:function(e,r){return""===r?(e.setAttribute(n,"auto"),r):t}})})),b.support.hrefNormalized||(b.each(["href","src","width","height"],function(e,n){b.attrHooks[n]=b.extend(b.attrHooks[n],{get:function(e){var r=e.getAttribute(n,2);return null==r?t:r}})}),b.each(["href","src"],function(e,t){b.propHooks[t]={get:function(e){return e.getAttribute(t,4)}}})),b.support.style||(b.attrHooks.style={get:function(e){return e.style.cssText||t},set:function(e,t){return e.style.cssText=t+""}}),b.support.optSelected||(b.propHooks.selected=b.extend(b.propHooks.selected,{get:function(e){var t=e.parentNode;return t&&(t.selectedIndex,t.parentNode&&t.parentNode.selectedIndex),null}})),b.support.enctype||(b.propFix.enctype="encoding"),b.support.checkOn||b.each(["radio","checkbox"],function(){b.valHooks[this]={get:function(e){return null===e.getAttribute("value")?"on":e.value}}}),b.each(["radio","checkbox"],function(){b.valHooks[this]=b.extend(b.valHooks[this],{set:function(e,n){return b.isArray(n)?e.checked=b.inArray(b(e).val(),n)>=0:t}})});var Z=/^(?:input|select|textarea)$/i,et=/^key/,tt=/^(?:mouse|contextmenu)|click/,nt=/^(?:focusinfocus|focusoutblur)$/,rt=/^([^.]*)(?:\.(.+)|)$/;function it(){return!0}function ot(){return!1}b.event={global:{},add:function(e,n,r,o,a){var s,u,l,c,p,f,d,h,g,m,y,v=b._data(e);if(v){r.handler&&(c=r,r=c.handler,a=c.selector),r.guid||(r.guid=b.guid++),(u=v.events)||(u=v.events={}),(f=v.handle)||(f=v.handle=function(e){return typeof b===i||e&&b.event.triggered===e.type?t:b.event.dispatch.apply(f.elem,arguments)},f.elem=e),n=(n||"").match(w)||[""],l=n.length;while(l--)s=rt.exec(n[l])||[],g=y=s[1],m=(s[2]||"").split(".").sort(),p=b.event.special[g]||{},g=(a?p.delegateType:p.bindType)||g,p=b.event.special[g]||{},d=b.extend({type:g,origType:y,data:o,handler:r,guid:r.guid,selector:a,needsContext:a&&b.expr.match.needsContext.test(a),namespace:m.join(".")},c),(h=u[g])||(h=u[g]=[],h.delegateCount=0,p.setup&&p.setup.call(e,o,m,f)!==!1||(e.addEventListener?e.addEventListener(g,f,!1):e.attachEvent&&e.attachEvent("on"+g,f))),p.add&&(p.add.call(e,d),d.handler.guid||(d.handler.guid=r.guid)),a?h.splice(h.delegateCount++,0,d):h.push(d),b.event.global[g]=!0;e=null}},remove:function(e,t,n,r,i){var o,a,s,u,l,c,p,f,d,h,g,m=b.hasData(e)&&b._data(e);if(m&&(c=m.events)){t=(t||"").match(w)||[""],l=t.length;while(l--)if(s=rt.exec(t[l])||[],d=g=s[1],h=(s[2]||"").split(".").sort(),d){p=b.event.special[d]||{},d=(r?p.delegateType:p.bindType)||d,f=c[d]||[],s=s[2]&&RegExp("(^|\\.)"+h.join("\\.(?:.*\\.|)")+"(\\.|$)"),u=o=f.length;while(o--)a=f[o],!i&&g!==a.origType||n&&n.guid!==a.guid||s&&!s.test(a.namespace)||r&&r!==a.selector&&("**"!==r||!a.selector)||(f.splice(o,1),a.selector&&f.delegateCount--,p.remove&&p.remove.call(e,a));u&&!f.length&&(p.teardown&&p.teardown.call(e,h,m.handle)!==!1||b.removeEvent(e,d,m.handle),delete c[d])}else for(d in c)b.event.remove(e,d+t[l],n,r,!0);b.isEmptyObject(c)&&(delete m.handle,b._removeData(e,"events"))}},trigger:function(n,r,i,a){var s,u,l,c,p,f,d,h=[i||o],g=y.call(n,"type")?n.type:n,m=y.call(n,"namespace")?n.namespace.split("."):[];if(l=f=i=i||o,3!==i.nodeType&&8!==i.nodeType&&!nt.test(g+b.event.triggered)&&(g.indexOf(".")>=0&&(m=g.split("."),g=m.shift(),m.sort()),u=0>g.indexOf(":")&&"on"+g,n=n[b.expando]?n:new b.Event(g,"object"==typeof n&&n),n.isTrigger=!0,n.namespace=m.join("."),n.namespace_re=n.namespace?RegExp("(^|\\.)"+m.join("\\.(?:.*\\.|)")+"(\\.|$)"):null,n.result=t,n.target||(n.target=i),r=null==r?[n]:b.makeArray(r,[n]),p=b.event.special[g]||{},a||!p.trigger||p.trigger.apply(i,r)!==!1)){if(!a&&!p.noBubble&&!b.isWindow(i)){for(c=p.delegateType||g,nt.test(c+g)||(l=l.parentNode);l;l=l.parentNode)h.push(l),f=l;f===(i.ownerDocument||o)&&h.push(f.defaultView||f.parentWindow||e)}d=0;while((l=h[d++])&&!n.isPropagationStopped())n.type=d>1?c:p.bindType||g,s=(b._data(l,"events")||{})[n.type]&&b._data(l,"handle"),s&&s.apply(l,r),s=u&&l[u],s&&b.acceptData(l)&&s.apply&&s.apply(l,r)===!1&&n.preventDefault();if(n.type=g,!(a||n.isDefaultPrevented()||p._default&&p._default.apply(i.ownerDocument,r)!==!1||"click"===g&&b.nodeName(i,"a")||!b.acceptData(i)||!u||!i[g]||b.isWindow(i))){f=i[u],f&&(i[u]=null),b.event.triggered=g;try{i[g]()}catch(v){}b.event.triggered=t,f&&(i[u]=f)}return n.result}},dispatch:function(e){e=b.event.fix(e);var n,r,i,o,a,s=[],u=h.call(arguments),l=(b._data(this,"events")||{})[e.type]||[],c=b.event.special[e.type]||{};if(u[0]=e,e.delegateTarget=this,!c.preDispatch||c.preDispatch.call(this,e)!==!1){s=b.event.handlers.call(this,e,l),n=0;while((o=s[n++])&&!e.isPropagationStopped()){e.currentTarget=o.elem,a=0;while((i=o.handlers[a++])&&!e.isImmediatePropagationStopped())(!e.namespace_re||e.namespace_re.test(i.namespace))&&(e.handleObj=i,e.data=i.data,r=((b.event.special[i.origType]||{}).handle||i.handler).apply(o.elem,u),r!==t&&(e.result=r)===!1&&(e.preventDefault(),e.stopPropagation()))}return c.postDispatch&&c.postDispatch.call(this,e),e.result}},handlers:function(e,n){var r,i,o,a,s=[],u=n.delegateCount,l=e.target;if(u&&l.nodeType&&(!e.button||"click"!==e.type))for(;l!=this;l=l.parentNode||this)if(1===l.nodeType&&(l.disabled!==!0||"click"!==e.type)){for(o=[],a=0;u>a;a++)i=n[a],r=i.selector+" ",o[r]===t&&(o[r]=i.needsContext?b(r,this).index(l)>=0:b.find(r,this,null,[l]).length),o[r]&&o.push(i);o.length&&s.push({elem:l,handlers:o})}return n.length>u&&s.push({elem:this,handlers:n.slice(u)}),s},fix:function(e){if(e[b.expando])return e;var t,n,r,i=e.type,a=e,s=this.fixHooks[i];s||(this.fixHooks[i]=s=tt.test(i)?this.mouseHooks:et.test(i)?this.keyHooks:{}),r=s.props?this.props.concat(s.props):this.props,e=new b.Event(a),t=r.length;while(t--)n=r[t],e[n]=a[n];return e.target||(e.target=a.srcElement||o),3===e.target.nodeType&&(e.target=e.target.parentNode),e.metaKey=!!e.metaKey,s.filter?s.filter(e,a):e},props:"altKey bubbles cancelable ctrlKey currentTarget eventPhase metaKey relatedTarget shiftKey target timeStamp view which".split(" "),fixHooks:{},keyHooks:{props:"char charCode key keyCode".split(" "),filter:function(e,t){return null==e.which&&(e.which=null!=t.charCode?t.charCode:t.keyCode),e}},mouseHooks:{props:"button buttons clientX clientY fromElement offsetX offsetY pageX pageY screenX screenY toElement".split(" "),filter:function(e,n){var r,i,a,s=n.button,u=n.fromElement;return null==e.pageX&&null!=n.clientX&&(i=e.target.ownerDocument||o,a=i.documentElement,r=i.body,e.pageX=n.clientX+(a&&a.scrollLeft||r&&r.scrollLeft||0)-(a&&a.clientLeft||r&&r.clientLeft||0),e.pageY=n.clientY+(a&&a.scrollTop||r&&r.scrollTop||0)-(a&&a.clientTop||r&&r.clientTop||0)),!e.relatedTarget&&u&&(e.relatedTarget=u===e.target?n.toElement:u),e.which||s===t||(e.which=1&s?1:2&s?3:4&s?2:0),e}},special:{load:{noBubble:!0},click:{trigger:function(){return b.nodeName(this,"input")&&"checkbox"===this.type&&this.click?(this.click(),!1):t}},focus:{trigger:function(){if(this!==o.activeElement&&this.focus)try{return this.focus(),!1}catch(e){}},delegateType:"focusin"},blur:{trigger:function(){return this===o.activeElement&&this.blur?(this.blur(),!1):t},delegateType:"focusout"},beforeunload:{postDispatch:function(e){e.result!==t&&(e.originalEvent.returnValue=e.result)}}},simulate:function(e,t,n,r){var i=b.extend(new b.Event,n,{type:e,isSimulated:!0,originalEvent:{}});r?b.event.trigger(i,null,t):b.event.dispatch.call(t,i),i.isDefaultPrevented()&&n.preventDefault()}},b.removeEvent=o.removeEventListener?function(e,t,n){e.removeEventListener&&e.removeEventListener(t,n,!1)}:function(e,t,n){var r="on"+t;e.detachEvent&&(typeof e[r]===i&&(e[r]=null),e.detachEvent(r,n))},b.Event=function(e,n){return this instanceof b.Event?(e&&e.type?(this.originalEvent=e,this.type=e.type,this.isDefaultPrevented=e.defaultPrevented||e.returnValue===!1||e.getPreventDefault&&e.getPreventDefault()?it:ot):this.type=e,n&&b.extend(this,n),this.timeStamp=e&&e.timeStamp||b.now(),this[b.expando]=!0,t):new b.Event(e,n)},b.Event.prototype={isDefaultPrevented:ot,isPropagationStopped:ot,isImmediatePropagationStopped:ot,preventDefault:function(){var e=this.originalEvent;this.isDefaultPrevented=it,e&&(e.preventDefault?e.preventDefault():e.returnValue=!1)},stopPropagation:function(){var e=this.originalEvent;this.isPropagationStopped=it,e&&(e.stopPropagation&&e.stopPropagation(),e.cancelBubble=!0)},stopImmediatePropagation:function(){this.isImmediatePropagationStopped=it,this.stopPropagation()}},b.each({mouseenter:"mouseover",mouseleave:"mouseout"},function(e,t){b.event.special[e]={delegateType:t,bindType:t,handle:function(e){var n,r=this,i=e.relatedTarget,o=e.handleObj;
return(!i||i!==r&&!b.contains(r,i))&&(e.type=o.origType,n=o.handler.apply(this,arguments),e.type=t),n}}}),b.support.submitBubbles||(b.event.special.submit={setup:function(){return b.nodeName(this,"form")?!1:(b.event.add(this,"click._submit keypress._submit",function(e){var n=e.target,r=b.nodeName(n,"input")||b.nodeName(n,"button")?n.form:t;r&&!b._data(r,"submitBubbles")&&(b.event.add(r,"submit._submit",function(e){e._submit_bubble=!0}),b._data(r,"submitBubbles",!0))}),t)},postDispatch:function(e){e._submit_bubble&&(delete e._submit_bubble,this.parentNode&&!e.isTrigger&&b.event.simulate("submit",this.parentNode,e,!0))},teardown:function(){return b.nodeName(this,"form")?!1:(b.event.remove(this,"._submit"),t)}}),b.support.changeBubbles||(b.event.special.change={setup:function(){return Z.test(this.nodeName)?(("checkbox"===this.type||"radio"===this.type)&&(b.event.add(this,"propertychange._change",function(e){"checked"===e.originalEvent.propertyName&&(this._just_changed=!0)}),b.event.add(this,"click._change",function(e){this._just_changed&&!e.isTrigger&&(this._just_changed=!1),b.event.simulate("change",this,e,!0)})),!1):(b.event.add(this,"beforeactivate._change",function(e){var t=e.target;Z.test(t.nodeName)&&!b._data(t,"changeBubbles")&&(b.event.add(t,"change._change",function(e){!this.parentNode||e.isSimulated||e.isTrigger||b.event.simulate("change",this.parentNode,e,!0)}),b._data(t,"changeBubbles",!0))}),t)},handle:function(e){var n=e.target;return this!==n||e.isSimulated||e.isTrigger||"radio"!==n.type&&"checkbox"!==n.type?e.handleObj.handler.apply(this,arguments):t},teardown:function(){return b.event.remove(this,"._change"),!Z.test(this.nodeName)}}),b.support.focusinBubbles||b.each({focus:"focusin",blur:"focusout"},function(e,t){var n=0,r=function(e){b.event.simulate(t,e.target,b.event.fix(e),!0)};b.event.special[t]={setup:function(){0===n++&&o.addEventListener(e,r,!0)},teardown:function(){0===--n&&o.removeEventListener(e,r,!0)}}}),b.fn.extend({on:function(e,n,r,i,o){var a,s;if("object"==typeof e){"string"!=typeof n&&(r=r||n,n=t);for(a in e)this.on(a,n,r,e[a],o);return this}if(null==r&&null==i?(i=n,r=n=t):null==i&&("string"==typeof n?(i=r,r=t):(i=r,r=n,n=t)),i===!1)i=ot;else if(!i)return this;return 1===o&&(s=i,i=function(e){return b().off(e),s.apply(this,arguments)},i.guid=s.guid||(s.guid=b.guid++)),this.each(function(){b.event.add(this,e,i,r,n)})},one:function(e,t,n,r){return this.on(e,t,n,r,1)},off:function(e,n,r){var i,o;if(e&&e.preventDefault&&e.handleObj)return i=e.handleObj,b(e.delegateTarget).off(i.namespace?i.origType+"."+i.namespace:i.origType,i.selector,i.handler),this;if("object"==typeof e){for(o in e)this.off(o,n,e[o]);return this}return(n===!1||"function"==typeof n)&&(r=n,n=t),r===!1&&(r=ot),this.each(function(){b.event.remove(this,e,r,n)})},bind:function(e,t,n){return this.on(e,null,t,n)},unbind:function(e,t){return this.off(e,null,t)},delegate:function(e,t,n,r){return this.on(t,e,n,r)},undelegate:function(e,t,n){return 1===arguments.length?this.off(e,"**"):this.off(t,e||"**",n)},trigger:function(e,t){return this.each(function(){b.event.trigger(e,t,this)})},triggerHandler:function(e,n){var r=this[0];return r?b.event.trigger(e,n,r,!0):t}}),function(e,t){var n,r,i,o,a,s,u,l,c,p,f,d,h,g,m,y,v,x="sizzle"+-new Date,w=e.document,T={},N=0,C=0,k=it(),E=it(),S=it(),A=typeof t,j=1<<31,D=[],L=D.pop,H=D.push,q=D.slice,M=D.indexOf||function(e){var t=0,n=this.length;for(;n>t;t++)if(this[t]===e)return t;return-1},_="[\\x20\\t\\r\\n\\f]",F="(?:\\\\.|[\\w-]|[^\\x00-\\xa0])+",O=F.replace("w","w#"),B="([*^$|!~]?=)",P="\\["+_+"*("+F+")"+_+"*(?:"+B+_+"*(?:(['\"])((?:\\\\.|[^\\\\])*?)\\3|("+O+")|)|)"+_+"*\\]",R=":("+F+")(?:\\(((['\"])((?:\\\\.|[^\\\\])*?)\\3|((?:\\\\.|[^\\\\()[\\]]|"+P.replace(3,8)+")*)|.*)\\)|)",W=RegExp("^"+_+"+|((?:^|[^\\\\])(?:\\\\.)*)"+_+"+$","g"),$=RegExp("^"+_+"*,"+_+"*"),I=RegExp("^"+_+"*([\\x20\\t\\r\\n\\f>+~])"+_+"*"),z=RegExp(R),X=RegExp("^"+O+"$"),U={ID:RegExp("^#("+F+")"),CLASS:RegExp("^\\.("+F+")"),NAME:RegExp("^\\[name=['\"]?("+F+")['\"]?\\]"),TAG:RegExp("^("+F.replace("w","w*")+")"),ATTR:RegExp("^"+P),PSEUDO:RegExp("^"+R),CHILD:RegExp("^:(only|first|last|nth|nth-last)-(child|of-type)(?:\\("+_+"*(even|odd|(([+-]|)(\\d*)n|)"+_+"*(?:([+-]|)"+_+"*(\\d+)|))"+_+"*\\)|)","i"),needsContext:RegExp("^"+_+"*[>+~]|:(even|odd|eq|gt|lt|nth|first|last)(?:\\("+_+"*((?:-\\d)?\\d*)"+_+"*\\)|)(?=[^-]|$)","i")},V=/[\x20\t\r\n\f]*[+~]/,Y=/^[^{]+\{\s*\[native code/,J=/^(?:#([\w-]+)|(\w+)|\.([\w-]+))$/,G=/^(?:input|select|textarea|button)$/i,Q=/^h\d$/i,K=/'|\\/g,Z=/\=[\x20\t\r\n\f]*([^'"\]]*)[\x20\t\r\n\f]*\]/g,et=/\\([\da-fA-F]{1,6}[\x20\t\r\n\f]?|.)/g,tt=function(e,t){var n="0x"+t-65536;return n!==n?t:0>n?String.fromCharCode(n+65536):String.fromCharCode(55296|n>>10,56320|1023&n)};try{q.call(w.documentElement.childNodes,0)[0].nodeType}catch(nt){q=function(e){var t,n=[];while(t=this[e++])n.push(t);return n}}function rt(e){return Y.test(e+"")}function it(){var e,t=[];return e=function(n,r){return t.push(n+=" ")>i.cacheLength&&delete e[t.shift()],e[n]=r}}function ot(e){return e[x]=!0,e}function at(e){var t=p.createElement("div");try{return e(t)}catch(n){return!1}finally{t=null}}function st(e,t,n,r){var i,o,a,s,u,l,f,g,m,v;if((t?t.ownerDocument||t:w)!==p&&c(t),t=t||p,n=n||[],!e||"string"!=typeof e)return n;if(1!==(s=t.nodeType)&&9!==s)return[];if(!d&&!r){if(i=J.exec(e))if(a=i[1]){if(9===s){if(o=t.getElementById(a),!o||!o.parentNode)return n;if(o.id===a)return n.push(o),n}else if(t.ownerDocument&&(o=t.ownerDocument.getElementById(a))&&y(t,o)&&o.id===a)return n.push(o),n}else{if(i[2])return H.apply(n,q.call(t.getElementsByTagName(e),0)),n;if((a=i[3])&&T.getByClassName&&t.getElementsByClassName)return H.apply(n,q.call(t.getElementsByClassName(a),0)),n}if(T.qsa&&!h.test(e)){if(f=!0,g=x,m=t,v=9===s&&e,1===s&&"object"!==t.nodeName.toLowerCase()){l=ft(e),(f=t.getAttribute("id"))?g=f.replace(K,"\\$&"):t.setAttribute("id",g),g="[id='"+g+"'] ",u=l.length;while(u--)l[u]=g+dt(l[u]);m=V.test(e)&&t.parentNode||t,v=l.join(",")}if(v)try{return H.apply(n,q.call(m.querySelectorAll(v),0)),n}catch(b){}finally{f||t.removeAttribute("id")}}}return wt(e.replace(W,"$1"),t,n,r)}a=st.isXML=function(e){var t=e&&(e.ownerDocument||e).documentElement;return t?"HTML"!==t.nodeName:!1},c=st.setDocument=function(e){var n=e?e.ownerDocument||e:w;return n!==p&&9===n.nodeType&&n.documentElement?(p=n,f=n.documentElement,d=a(n),T.tagNameNoComments=at(function(e){return e.appendChild(n.createComment("")),!e.getElementsByTagName("*").length}),T.attributes=at(function(e){e.innerHTML="<select></select>";var t=typeof e.lastChild.getAttribute("multiple");return"boolean"!==t&&"string"!==t}),T.getByClassName=at(function(e){return e.innerHTML="<div class='hidden e'></div><div class='hidden'></div>",e.getElementsByClassName&&e.getElementsByClassName("e").length?(e.lastChild.className="e",2===e.getElementsByClassName("e").length):!1}),T.getByName=at(function(e){e.id=x+0,e.innerHTML="<a name='"+x+"'></a><div name='"+x+"'></div>",f.insertBefore(e,f.firstChild);var t=n.getElementsByName&&n.getElementsByName(x).length===2+n.getElementsByName(x+0).length;return T.getIdNotName=!n.getElementById(x),f.removeChild(e),t}),i.attrHandle=at(function(e){return e.innerHTML="<a href='#'></a>",e.firstChild&&typeof e.firstChild.getAttribute!==A&&"#"===e.firstChild.getAttribute("href")})?{}:{href:function(e){return e.getAttribute("href",2)},type:function(e){return e.getAttribute("type")}},T.getIdNotName?(i.find.ID=function(e,t){if(typeof t.getElementById!==A&&!d){var n=t.getElementById(e);return n&&n.parentNode?[n]:[]}},i.filter.ID=function(e){var t=e.replace(et,tt);return function(e){return e.getAttribute("id")===t}}):(i.find.ID=function(e,n){if(typeof n.getElementById!==A&&!d){var r=n.getElementById(e);return r?r.id===e||typeof r.getAttributeNode!==A&&r.getAttributeNode("id").value===e?[r]:t:[]}},i.filter.ID=function(e){var t=e.replace(et,tt);return function(e){var n=typeof e.getAttributeNode!==A&&e.getAttributeNode("id");return n&&n.value===t}}),i.find.TAG=T.tagNameNoComments?function(e,n){return typeof n.getElementsByTagName!==A?n.getElementsByTagName(e):t}:function(e,t){var n,r=[],i=0,o=t.getElementsByTagName(e);if("*"===e){while(n=o[i++])1===n.nodeType&&r.push(n);return r}return o},i.find.NAME=T.getByName&&function(e,n){return typeof n.getElementsByName!==A?n.getElementsByName(name):t},i.find.CLASS=T.getByClassName&&function(e,n){return typeof n.getElementsByClassName===A||d?t:n.getElementsByClassName(e)},g=[],h=[":focus"],(T.qsa=rt(n.querySelectorAll))&&(at(function(e){e.innerHTML="<select><option selected=''></option></select>",e.querySelectorAll("[selected]").length||h.push("\\["+_+"*(?:checked|disabled|ismap|multiple|readonly|selected|value)"),e.querySelectorAll(":checked").length||h.push(":checked")}),at(function(e){e.innerHTML="<input type='hidden' i=''/>",e.querySelectorAll("[i^='']").length&&h.push("[*^$]="+_+"*(?:\"\"|'')"),e.querySelectorAll(":enabled").length||h.push(":enabled",":disabled"),e.querySelectorAll("*,:x"),h.push(",.*:")})),(T.matchesSelector=rt(m=f.matchesSelector||f.mozMatchesSelector||f.webkitMatchesSelector||f.oMatchesSelector||f.msMatchesSelector))&&at(function(e){T.disconnectedMatch=m.call(e,"div"),m.call(e,"[s!='']:x"),g.push("!=",R)}),h=RegExp(h.join("|")),g=RegExp(g.join("|")),y=rt(f.contains)||f.compareDocumentPosition?function(e,t){var n=9===e.nodeType?e.documentElement:e,r=t&&t.parentNode;return e===r||!(!r||1!==r.nodeType||!(n.contains?n.contains(r):e.compareDocumentPosition&&16&e.compareDocumentPosition(r)))}:function(e,t){if(t)while(t=t.parentNode)if(t===e)return!0;return!1},v=f.compareDocumentPosition?function(e,t){var r;return e===t?(u=!0,0):(r=t.compareDocumentPosition&&e.compareDocumentPosition&&e.compareDocumentPosition(t))?1&r||e.parentNode&&11===e.parentNode.nodeType?e===n||y(w,e)?-1:t===n||y(w,t)?1:0:4&r?-1:1:e.compareDocumentPosition?-1:1}:function(e,t){var r,i=0,o=e.parentNode,a=t.parentNode,s=[e],l=[t];if(e===t)return u=!0,0;if(!o||!a)return e===n?-1:t===n?1:o?-1:a?1:0;if(o===a)return ut(e,t);r=e;while(r=r.parentNode)s.unshift(r);r=t;while(r=r.parentNode)l.unshift(r);while(s[i]===l[i])i++;return i?ut(s[i],l[i]):s[i]===w?-1:l[i]===w?1:0},u=!1,[0,0].sort(v),T.detectDuplicates=u,p):p},st.matches=function(e,t){return st(e,null,null,t)},st.matchesSelector=function(e,t){if((e.ownerDocument||e)!==p&&c(e),t=t.replace(Z,"='$1']"),!(!T.matchesSelector||d||g&&g.test(t)||h.test(t)))try{var n=m.call(e,t);if(n||T.disconnectedMatch||e.document&&11!==e.document.nodeType)return n}catch(r){}return st(t,p,null,[e]).length>0},st.contains=function(e,t){return(e.ownerDocument||e)!==p&&c(e),y(e,t)},st.attr=function(e,t){var n;return(e.ownerDocument||e)!==p&&c(e),d||(t=t.toLowerCase()),(n=i.attrHandle[t])?n(e):d||T.attributes?e.getAttribute(t):((n=e.getAttributeNode(t))||e.getAttribute(t))&&e[t]===!0?t:n&&n.specified?n.value:null},st.error=function(e){throw Error("Syntax error, unrecognized expression: "+e)},st.uniqueSort=function(e){var t,n=[],r=1,i=0;if(u=!T.detectDuplicates,e.sort(v),u){for(;t=e[r];r++)t===e[r-1]&&(i=n.push(r));while(i--)e.splice(n[i],1)}return e};function ut(e,t){var n=t&&e,r=n&&(~t.sourceIndex||j)-(~e.sourceIndex||j);if(r)return r;if(n)while(n=n.nextSibling)if(n===t)return-1;return e?1:-1}function lt(e){return function(t){var n=t.nodeName.toLowerCase();return"input"===n&&t.type===e}}function ct(e){return function(t){var n=t.nodeName.toLowerCase();return("input"===n||"button"===n)&&t.type===e}}function pt(e){return ot(function(t){return t=+t,ot(function(n,r){var i,o=e([],n.length,t),a=o.length;while(a--)n[i=o[a]]&&(n[i]=!(r[i]=n[i]))})})}o=st.getText=function(e){var t,n="",r=0,i=e.nodeType;if(i){if(1===i||9===i||11===i){if("string"==typeof e.textContent)return e.textContent;for(e=e.firstChild;e;e=e.nextSibling)n+=o(e)}else if(3===i||4===i)return e.nodeValue}else for(;t=e[r];r++)n+=o(t);return n},i=st.selectors={cacheLength:50,createPseudo:ot,match:U,find:{},relative:{">":{dir:"parentNode",first:!0}," ":{dir:"parentNode"},"+":{dir:"previousSibling",first:!0},"~":{dir:"previousSibling"}},preFilter:{ATTR:function(e){return e[1]=e[1].replace(et,tt),e[3]=(e[4]||e[5]||"").replace(et,tt),"~="===e[2]&&(e[3]=" "+e[3]+" "),e.slice(0,4)},CHILD:function(e){return e[1]=e[1].toLowerCase(),"nth"===e[1].slice(0,3)?(e[3]||st.error(e[0]),e[4]=+(e[4]?e[5]+(e[6]||1):2*("even"===e[3]||"odd"===e[3])),e[5]=+(e[7]+e[8]||"odd"===e[3])):e[3]&&st.error(e[0]),e},PSEUDO:function(e){var t,n=!e[5]&&e[2];return U.CHILD.test(e[0])?null:(e[4]?e[2]=e[4]:n&&z.test(n)&&(t=ft(n,!0))&&(t=n.indexOf(")",n.length-t)-n.length)&&(e[0]=e[0].slice(0,t),e[2]=n.slice(0,t)),e.slice(0,3))}},filter:{TAG:function(e){return"*"===e?function(){return!0}:(e=e.replace(et,tt).toLowerCase(),function(t){return t.nodeName&&t.nodeName.toLowerCase()===e})},CLASS:function(e){var t=k[e+" "];return t||(t=RegExp("(^|"+_+")"+e+"("+_+"|$)"))&&k(e,function(e){return t.test(e.className||typeof e.getAttribute!==A&&e.getAttribute("class")||"")})},ATTR:function(e,t,n){return function(r){var i=st.attr(r,e);return null==i?"!="===t:t?(i+="","="===t?i===n:"!="===t?i!==n:"^="===t?n&&0===i.indexOf(n):"*="===t?n&&i.indexOf(n)>-1:"$="===t?n&&i.slice(-n.length)===n:"~="===t?(" "+i+" ").indexOf(n)>-1:"|="===t?i===n||i.slice(0,n.length+1)===n+"-":!1):!0}},CHILD:function(e,t,n,r,i){var o="nth"!==e.slice(0,3),a="last"!==e.slice(-4),s="of-type"===t;return 1===r&&0===i?function(e){return!!e.parentNode}:function(t,n,u){var l,c,p,f,d,h,g=o!==a?"nextSibling":"previousSibling",m=t.parentNode,y=s&&t.nodeName.toLowerCase(),v=!u&&!s;if(m){if(o){while(g){p=t;while(p=p[g])if(s?p.nodeName.toLowerCase()===y:1===p.nodeType)return!1;h=g="only"===e&&!h&&"nextSibling"}return!0}if(h=[a?m.firstChild:m.lastChild],a&&v){c=m[x]||(m[x]={}),l=c[e]||[],d=l[0]===N&&l[1],f=l[0]===N&&l[2],p=d&&m.childNodes[d];while(p=++d&&p&&p[g]||(f=d=0)||h.pop())if(1===p.nodeType&&++f&&p===t){c[e]=[N,d,f];break}}else if(v&&(l=(t[x]||(t[x]={}))[e])&&l[0]===N)f=l[1];else while(p=++d&&p&&p[g]||(f=d=0)||h.pop())if((s?p.nodeName.toLowerCase()===y:1===p.nodeType)&&++f&&(v&&((p[x]||(p[x]={}))[e]=[N,f]),p===t))break;return f-=i,f===r||0===f%r&&f/r>=0}}},PSEUDO:function(e,t){var n,r=i.pseudos[e]||i.setFilters[e.toLowerCase()]||st.error("unsupported pseudo: "+e);return r[x]?r(t):r.length>1?(n=[e,e,"",t],i.setFilters.hasOwnProperty(e.toLowerCase())?ot(function(e,n){var i,o=r(e,t),a=o.length;while(a--)i=M.call(e,o[a]),e[i]=!(n[i]=o[a])}):function(e){return r(e,0,n)}):r}},pseudos:{not:ot(function(e){var t=[],n=[],r=s(e.replace(W,"$1"));return r[x]?ot(function(e,t,n,i){var o,a=r(e,null,i,[]),s=e.length;while(s--)(o=a[s])&&(e[s]=!(t[s]=o))}):function(e,i,o){return t[0]=e,r(t,null,o,n),!n.pop()}}),has:ot(function(e){return function(t){return st(e,t).length>0}}),contains:ot(function(e){return function(t){return(t.textContent||t.innerText||o(t)).indexOf(e)>-1}}),lang:ot(function(e){return X.test(e||"")||st.error("unsupported lang: "+e),e=e.replace(et,tt).toLowerCase(),function(t){var n;do if(n=d?t.getAttribute("xml:lang")||t.getAttribute("lang"):t.lang)return n=n.toLowerCase(),n===e||0===n.indexOf(e+"-");while((t=t.parentNode)&&1===t.nodeType);return!1}}),target:function(t){var n=e.location&&e.location.hash;return n&&n.slice(1)===t.id},root:function(e){return e===f},focus:function(e){return e===p.activeElement&&(!p.hasFocus||p.hasFocus())&&!!(e.type||e.href||~e.tabIndex)},enabled:function(e){return e.disabled===!1},disabled:function(e){return e.disabled===!0},checked:function(e){var t=e.nodeName.toLowerCase();return"input"===t&&!!e.checked||"option"===t&&!!e.selected},selected:function(e){return e.parentNode&&e.parentNode.selectedIndex,e.selected===!0},empty:function(e){for(e=e.firstChild;e;e=e.nextSibling)if(e.nodeName>"@"||3===e.nodeType||4===e.nodeType)return!1;return!0},parent:function(e){return!i.pseudos.empty(e)},header:function(e){return Q.test(e.nodeName)},input:function(e){return G.test(e.nodeName)},button:function(e){var t=e.nodeName.toLowerCase();return"input"===t&&"button"===e.type||"button"===t},text:function(e){var t;return"input"===e.nodeName.toLowerCase()&&"text"===e.type&&(null==(t=e.getAttribute("type"))||t.toLowerCase()===e.type)},first:pt(function(){return[0]}),last:pt(function(e,t){return[t-1]}),eq:pt(function(e,t,n){return[0>n?n+t:n]}),even:pt(function(e,t){var n=0;for(;t>n;n+=2)e.push(n);return e}),odd:pt(function(e,t){var n=1;for(;t>n;n+=2)e.push(n);return e}),lt:pt(function(e,t,n){var r=0>n?n+t:n;for(;--r>=0;)e.push(r);return e}),gt:pt(function(e,t,n){var r=0>n?n+t:n;for(;t>++r;)e.push(r);return e})}};for(n in{radio:!0,checkbox:!0,file:!0,password:!0,image:!0})i.pseudos[n]=lt(n);for(n in{submit:!0,reset:!0})i.pseudos[n]=ct(n);function ft(e,t){var n,r,o,a,s,u,l,c=E[e+" "];if(c)return t?0:c.slice(0);s=e,u=[],l=i.preFilter;while(s){(!n||(r=$.exec(s)))&&(r&&(s=s.slice(r[0].length)||s),u.push(o=[])),n=!1,(r=I.exec(s))&&(n=r.shift(),o.push({value:n,type:r[0].replace(W," ")}),s=s.slice(n.length));for(a in i.filter)!(r=U[a].exec(s))||l[a]&&!(r=l[a](r))||(n=r.shift(),o.push({value:n,type:a,matches:r}),s=s.slice(n.length));if(!n)break}return t?s.length:s?st.error(e):E(e,u).slice(0)}function dt(e){var t=0,n=e.length,r="";for(;n>t;t++)r+=e[t].value;return r}function ht(e,t,n){var i=t.dir,o=n&&"parentNode"===i,a=C++;return t.first?function(t,n,r){while(t=t[i])if(1===t.nodeType||o)return e(t,n,r)}:function(t,n,s){var u,l,c,p=N+" "+a;if(s){while(t=t[i])if((1===t.nodeType||o)&&e(t,n,s))return!0}else while(t=t[i])if(1===t.nodeType||o)if(c=t[x]||(t[x]={}),(l=c[i])&&l[0]===p){if((u=l[1])===!0||u===r)return u===!0}else if(l=c[i]=[p],l[1]=e(t,n,s)||r,l[1]===!0)return!0}}function gt(e){return e.length>1?function(t,n,r){var i=e.length;while(i--)if(!e[i](t,n,r))return!1;return!0}:e[0]}function mt(e,t,n,r,i){var o,a=[],s=0,u=e.length,l=null!=t;for(;u>s;s++)(o=e[s])&&(!n||n(o,r,i))&&(a.push(o),l&&t.push(s));return a}function yt(e,t,n,r,i,o){return r&&!r[x]&&(r=yt(r)),i&&!i[x]&&(i=yt(i,o)),ot(function(o,a,s,u){var l,c,p,f=[],d=[],h=a.length,g=o||xt(t||"*",s.nodeType?[s]:s,[]),m=!e||!o&&t?g:mt(g,f,e,s,u),y=n?i||(o?e:h||r)?[]:a:m;if(n&&n(m,y,s,u),r){l=mt(y,d),r(l,[],s,u),c=l.length;while(c--)(p=l[c])&&(y[d[c]]=!(m[d[c]]=p))}if(o){if(i||e){if(i){l=[],c=y.length;while(c--)(p=y[c])&&l.push(m[c]=p);i(null,y=[],l,u)}c=y.length;while(c--)(p=y[c])&&(l=i?M.call(o,p):f[c])>-1&&(o[l]=!(a[l]=p))}}else y=mt(y===a?y.splice(h,y.length):y),i?i(null,a,y,u):H.apply(a,y)})}function vt(e){var t,n,r,o=e.length,a=i.relative[e[0].type],s=a||i.relative[" "],u=a?1:0,c=ht(function(e){return e===t},s,!0),p=ht(function(e){return M.call(t,e)>-1},s,!0),f=[function(e,n,r){return!a&&(r||n!==l)||((t=n).nodeType?c(e,n,r):p(e,n,r))}];for(;o>u;u++)if(n=i.relative[e[u].type])f=[ht(gt(f),n)];else{if(n=i.filter[e[u].type].apply(null,e[u].matches),n[x]){for(r=++u;o>r;r++)if(i.relative[e[r].type])break;return yt(u>1&&gt(f),u>1&&dt(e.slice(0,u-1)).replace(W,"$1"),n,r>u&&vt(e.slice(u,r)),o>r&&vt(e=e.slice(r)),o>r&&dt(e))}f.push(n)}return gt(f)}function bt(e,t){var n=0,o=t.length>0,a=e.length>0,s=function(s,u,c,f,d){var h,g,m,y=[],v=0,b="0",x=s&&[],w=null!=d,T=l,C=s||a&&i.find.TAG("*",d&&u.parentNode||u),k=N+=null==T?1:Math.random()||.1;for(w&&(l=u!==p&&u,r=n);null!=(h=C[b]);b++){if(a&&h){g=0;while(m=e[g++])if(m(h,u,c)){f.push(h);break}w&&(N=k,r=++n)}o&&((h=!m&&h)&&v--,s&&x.push(h))}if(v+=b,o&&b!==v){g=0;while(m=t[g++])m(x,y,u,c);if(s){if(v>0)while(b--)x[b]||y[b]||(y[b]=L.call(f));y=mt(y)}H.apply(f,y),w&&!s&&y.length>0&&v+t.length>1&&st.uniqueSort(f)}return w&&(N=k,l=T),x};return o?ot(s):s}s=st.compile=function(e,t){var n,r=[],i=[],o=S[e+" "];if(!o){t||(t=ft(e)),n=t.length;while(n--)o=vt(t[n]),o[x]?r.push(o):i.push(o);o=S(e,bt(i,r))}return o};function xt(e,t,n){var r=0,i=t.length;for(;i>r;r++)st(e,t[r],n);return n}function wt(e,t,n,r){var o,a,u,l,c,p=ft(e);if(!r&&1===p.length){if(a=p[0]=p[0].slice(0),a.length>2&&"ID"===(u=a[0]).type&&9===t.nodeType&&!d&&i.relative[a[1].type]){if(t=i.find.ID(u.matches[0].replace(et,tt),t)[0],!t)return n;e=e.slice(a.shift().value.length)}o=U.needsContext.test(e)?0:a.length;while(o--){if(u=a[o],i.relative[l=u.type])break;if((c=i.find[l])&&(r=c(u.matches[0].replace(et,tt),V.test(a[0].type)&&t.parentNode||t))){if(a.splice(o,1),e=r.length&&dt(a),!e)return H.apply(n,q.call(r,0)),n;break}}}return s(e,p)(r,t,d,n,V.test(e)),n}i.pseudos.nth=i.pseudos.eq;function Tt(){}i.filters=Tt.prototype=i.pseudos,i.setFilters=new Tt,c(),st.attr=b.attr,b.find=st,b.expr=st.selectors,b.expr[":"]=b.expr.pseudos,b.unique=st.uniqueSort,b.text=st.getText,b.isXMLDoc=st.isXML,b.contains=st.contains}(e);var at=/Until$/,st=/^(?:parents|prev(?:Until|All))/,ut=/^.[^:#\[\.,]*$/,lt=b.expr.match.needsContext,ct={children:!0,contents:!0,next:!0,prev:!0};b.fn.extend({find:function(e){var t,n,r,i=this.length;if("string"!=typeof e)return r=this,this.pushStack(b(e).filter(function(){for(t=0;i>t;t++)if(b.contains(r[t],this))return!0}));for(n=[],t=0;i>t;t++)b.find(e,this[t],n);return n=this.pushStack(i>1?b.unique(n):n),n.selector=(this.selector?this.selector+" ":"")+e,n},has:function(e){var t,n=b(e,this),r=n.length;return this.filter(function(){for(t=0;r>t;t++)if(b.contains(this,n[t]))return!0})},not:function(e){return this.pushStack(ft(this,e,!1))},filter:function(e){return this.pushStack(ft(this,e,!0))},is:function(e){return!!e&&("string"==typeof e?lt.test(e)?b(e,this.context).index(this[0])>=0:b.filter(e,this).length>0:this.filter(e).length>0)},closest:function(e,t){var n,r=0,i=this.length,o=[],a=lt.test(e)||"string"!=typeof e?b(e,t||this.context):0;for(;i>r;r++){n=this[r];while(n&&n.ownerDocument&&n!==t&&11!==n.nodeType){if(a?a.index(n)>-1:b.find.matchesSelector(n,e)){o.push(n);break}n=n.parentNode}}return this.pushStack(o.length>1?b.unique(o):o)},index:function(e){return e?"string"==typeof e?b.inArray(this[0],b(e)):b.inArray(e.jquery?e[0]:e,this):this[0]&&this[0].parentNode?this.first().prevAll().length:-1},add:function(e,t){var n="string"==typeof e?b(e,t):b.makeArray(e&&e.nodeType?[e]:e),r=b.merge(this.get(),n);return this.pushStack(b.unique(r))},addBack:function(e){return this.add(null==e?this.prevObject:this.prevObject.filter(e))}}),b.fn.andSelf=b.fn.addBack;function pt(e,t){do e=e[t];while(e&&1!==e.nodeType);return e}b.each({parent:function(e){var t=e.parentNode;return t&&11!==t.nodeType?t:null},parents:function(e){return b.dir(e,"parentNode")},parentsUntil:function(e,t,n){return b.dir(e,"parentNode",n)},next:function(e){return pt(e,"nextSibling")},prev:function(e){return pt(e,"previousSibling")},nextAll:function(e){return b.dir(e,"nextSibling")},prevAll:function(e){return b.dir(e,"previousSibling")},nextUntil:function(e,t,n){return b.dir(e,"nextSibling",n)},prevUntil:function(e,t,n){return b.dir(e,"previousSibling",n)},siblings:function(e){return b.sibling((e.parentNode||{}).firstChild,e)},children:function(e){return b.sibling(e.firstChild)},contents:function(e){return b.nodeName(e,"iframe")?e.contentDocument||e.contentWindow.document:b.merge([],e.childNodes)}},function(e,t){b.fn[e]=function(n,r){var i=b.map(this,t,n);return at.test(e)||(r=n),r&&"string"==typeof r&&(i=b.filter(r,i)),i=this.length>1&&!ct[e]?b.unique(i):i,this.length>1&&st.test(e)&&(i=i.reverse()),this.pushStack(i)}}),b.extend({filter:function(e,t,n){return n&&(e=":not("+e+")"),1===t.length?b.find.matchesSelector(t[0],e)?[t[0]]:[]:b.find.matches(e,t)},dir:function(e,n,r){var i=[],o=e[n];while(o&&9!==o.nodeType&&(r===t||1!==o.nodeType||!b(o).is(r)))1===o.nodeType&&i.push(o),o=o[n];return i},sibling:function(e,t){var n=[];for(;e;e=e.nextSibling)1===e.nodeType&&e!==t&&n.push(e);return n}});function ft(e,t,n){if(t=t||0,b.isFunction(t))return b.grep(e,function(e,r){var i=!!t.call(e,r,e);return i===n});if(t.nodeType)return b.grep(e,function(e){return e===t===n});if("string"==typeof t){var r=b.grep(e,function(e){return 1===e.nodeType});if(ut.test(t))return b.filter(t,r,!n);t=b.filter(t,r)}return b.grep(e,function(e){return b.inArray(e,t)>=0===n})}function dt(e){var t=ht.split("|"),n=e.createDocumentFragment();if(n.createElement)while(t.length)n.createElement(t.pop());return n}var ht="abbr|article|aside|audio|bdi|canvas|data|datalist|details|figcaption|figure|footer|header|hgroup|mark|meter|nav|output|progress|section|summary|time|video",gt=/ jQuery\d+="(?:null|\d+)"/g,mt=RegExp("<(?:"+ht+")[\\s/>]","i"),yt=/^\s+/,vt=/<(?!area|br|col|embed|hr|img|input|link|meta|param)(([\w:]+)[^>]*)\/>/gi,bt=/<([\w:]+)/,xt=/<tbody/i,wt=/<|&#?\w+;/,Tt=/<(?:script|style|link)/i,Nt=/^(?:checkbox|radio)$/i,Ct=/checked\s*(?:[^=]|=\s*.checked.)/i,kt=/^$|\/(?:java|ecma)script/i,Et=/^true\/(.*)/,St=/^\s*<!(?:\[CDATA\[|--)|(?:\]\]|--)>\s*$/g,At={option:[1,"<select multiple='multiple'>","</select>"],legend:[1,"<fieldset>","</fieldset>"],area:[1,"<map>","</map>"],param:[1,"<object>","</object>"],thead:[1,"<table>","</table>"],tr:[2,"<table><tbody>","</tbody></table>"],col:[2,"<table><tbody></tbody><colgroup>","</colgroup></table>"],td:[3,"<table><tbody><tr>","</tr></tbody></table>"],_default:b.support.htmlSerialize?[0,"",""]:[1,"X<div>","</div>"]},jt=dt(o),Dt=jt.appendChild(o.createElement("div"));At.optgroup=At.option,At.tbody=At.tfoot=At.colgroup=At.caption=At.thead,At.th=At.td,b.fn.extend({text:function(e){return b.access(this,function(e){return e===t?b.text(this):this.empty().append((this[0]&&this[0].ownerDocument||o).createTextNode(e))},null,e,arguments.length)},wrapAll:function(e){if(b.isFunction(e))return this.each(function(t){b(this).wrapAll(e.call(this,t))});if(this[0]){var t=b(e,this[0].ownerDocument).eq(0).clone(!0);this[0].parentNode&&t.insertBefore(this[0]),t.map(function(){var e=this;while(e.firstChild&&1===e.firstChild.nodeType)e=e.firstChild;return e}).append(this)}return this},wrapInner:function(e){return b.isFunction(e)?this.each(function(t){b(this).wrapInner(e.call(this,t))}):this.each(function(){var t=b(this),n=t.contents();n.length?n.wrapAll(e):t.append(e)})},wrap:function(e){var t=b.isFunction(e);return this.each(function(n){b(this).wrapAll(t?e.call(this,n):e)})},unwrap:function(){return this.parent().each(function(){b.nodeName(this,"body")||b(this).replaceWith(this.childNodes)}).end()},append:function(){return this.domManip(arguments,!0,function(e){(1===this.nodeType||11===this.nodeType||9===this.nodeType)&&this.appendChild(e)})},prepend:function(){return this.domManip(arguments,!0,function(e){(1===this.nodeType||11===this.nodeType||9===this.nodeType)&&this.insertBefore(e,this.firstChild)})},before:function(){return this.domManip(arguments,!1,function(e){this.parentNode&&this.parentNode.insertBefore(e,this)})},after:function(){return this.domManip(arguments,!1,function(e){this.parentNode&&this.parentNode.insertBefore(e,this.nextSibling)})},remove:function(e,t){var n,r=0;for(;null!=(n=this[r]);r++)(!e||b.filter(e,[n]).length>0)&&(t||1!==n.nodeType||b.cleanData(Ot(n)),n.parentNode&&(t&&b.contains(n.ownerDocument,n)&&Mt(Ot(n,"script")),n.parentNode.removeChild(n)));return this},empty:function(){var e,t=0;for(;null!=(e=this[t]);t++){1===e.nodeType&&b.cleanData(Ot(e,!1));while(e.firstChild)e.removeChild(e.firstChild);e.options&&b.nodeName(e,"select")&&(e.options.length=0)}return this},clone:function(e,t){return e=null==e?!1:e,t=null==t?e:t,this.map(function(){return b.clone(this,e,t)})},html:function(e){return b.access(this,function(e){var n=this[0]||{},r=0,i=this.length;if(e===t)return 1===n.nodeType?n.innerHTML.replace(gt,""):t;if(!("string"!=typeof e||Tt.test(e)||!b.support.htmlSerialize&&mt.test(e)||!b.support.leadingWhitespace&&yt.test(e)||At[(bt.exec(e)||["",""])[1].toLowerCase()])){e=e.replace(vt,"<$1></$2>");try{for(;i>r;r++)n=this[r]||{},1===n.nodeType&&(b.cleanData(Ot(n,!1)),n.innerHTML=e);n=0}catch(o){}}n&&this.empty().append(e)},null,e,arguments.length)},replaceWith:function(e){var t=b.isFunction(e);return t||"string"==typeof e||(e=b(e).not(this).detach()),this.domManip([e],!0,function(e){var t=this.nextSibling,n=this.parentNode;n&&(b(this).remove(),n.insertBefore(e,t))})},detach:function(e){return this.remove(e,!0)},domManip:function(e,n,r){e=f.apply([],e);var i,o,a,s,u,l,c=0,p=this.length,d=this,h=p-1,g=e[0],m=b.isFunction(g);if(m||!(1>=p||"string"!=typeof g||b.support.checkClone)&&Ct.test(g))return this.each(function(i){var o=d.eq(i);m&&(e[0]=g.call(this,i,n?o.html():t)),o.domManip(e,n,r)});if(p&&(l=b.buildFragment(e,this[0].ownerDocument,!1,this),i=l.firstChild,1===l.childNodes.length&&(l=i),i)){for(n=n&&b.nodeName(i,"tr"),s=b.map(Ot(l,"script"),Ht),a=s.length;p>c;c++)o=l,c!==h&&(o=b.clone(o,!0,!0),a&&b.merge(s,Ot(o,"script"))),r.call(n&&b.nodeName(this[c],"table")?Lt(this[c],"tbody"):this[c],o,c);if(a)for(u=s[s.length-1].ownerDocument,b.map(s,qt),c=0;a>c;c++)o=s[c],kt.test(o.type||"")&&!b._data(o,"globalEval")&&b.contains(u,o)&&(o.src?b.ajax({url:o.src,type:"GET",dataType:"script",async:!1,global:!1,"throws":!0}):b.globalEval((o.text||o.textContent||o.innerHTML||"").replace(St,"")));l=i=null}return this}});function Lt(e,t){return e.getElementsByTagName(t)[0]||e.appendChild(e.ownerDocument.createElement(t))}function Ht(e){var t=e.getAttributeNode("type");return e.type=(t&&t.specified)+"/"+e.type,e}function qt(e){var t=Et.exec(e.type);return t?e.type=t[1]:e.removeAttribute("type"),e}function Mt(e,t){var n,r=0;for(;null!=(n=e[r]);r++)b._data(n,"globalEval",!t||b._data(t[r],"globalEval"))}function _t(e,t){if(1===t.nodeType&&b.hasData(e)){var n,r,i,o=b._data(e),a=b._data(t,o),s=o.events;if(s){delete a.handle,a.events={};for(n in s)for(r=0,i=s[n].length;i>r;r++)b.event.add(t,n,s[n][r])}a.data&&(a.data=b.extend({},a.data))}}function Ft(e,t){var n,r,i;if(1===t.nodeType){if(n=t.nodeName.toLowerCase(),!b.support.noCloneEvent&&t[b.expando]){i=b._data(t);for(r in i.events)b.removeEvent(t,r,i.handle);t.removeAttribute(b.expando)}"script"===n&&t.text!==e.text?(Ht(t).text=e.text,qt(t)):"object"===n?(t.parentNode&&(t.outerHTML=e.outerHTML),b.support.html5Clone&&e.innerHTML&&!b.trim(t.innerHTML)&&(t.innerHTML=e.innerHTML)):"input"===n&&Nt.test(e.type)?(t.defaultChecked=t.checked=e.checked,t.value!==e.value&&(t.value=e.value)):"option"===n?t.defaultSelected=t.selected=e.defaultSelected:("input"===n||"textarea"===n)&&(t.defaultValue=e.defaultValue)}}b.each({appendTo:"append",prependTo:"prepend",insertBefore:"before",insertAfter:"after",replaceAll:"replaceWith"},function(e,t){b.fn[e]=function(e){var n,r=0,i=[],o=b(e),a=o.length-1;for(;a>=r;r++)n=r===a?this:this.clone(!0),b(o[r])[t](n),d.apply(i,n.get());return this.pushStack(i)}});function Ot(e,n){var r,o,a=0,s=typeof e.getElementsByTagName!==i?e.getElementsByTagName(n||"*"):typeof e.querySelectorAll!==i?e.querySelectorAll(n||"*"):t;if(!s)for(s=[],r=e.childNodes||e;null!=(o=r[a]);a++)!n||b.nodeName(o,n)?s.push(o):b.merge(s,Ot(o,n));return n===t||n&&b.nodeName(e,n)?b.merge([e],s):s}function Bt(e){Nt.test(e.type)&&(e.defaultChecked=e.checked)}b.extend({clone:function(e,t,n){var r,i,o,a,s,u=b.contains(e.ownerDocument,e);if(b.support.html5Clone||b.isXMLDoc(e)||!mt.test("<"+e.nodeName+">")?o=e.cloneNode(!0):(Dt.innerHTML=e.outerHTML,Dt.removeChild(o=Dt.firstChild)),!(b.support.noCloneEvent&&b.support.noCloneChecked||1!==e.nodeType&&11!==e.nodeType||b.isXMLDoc(e)))for(r=Ot(o),s=Ot(e),a=0;null!=(i=s[a]);++a)r[a]&&Ft(i,r[a]);if(t)if(n)for(s=s||Ot(e),r=r||Ot(o),a=0;null!=(i=s[a]);a++)_t(i,r[a]);else _t(e,o);return r=Ot(o,"script"),r.length>0&&Mt(r,!u&&Ot(e,"script")),r=s=i=null,o},buildFragment:function(e,t,n,r){var i,o,a,s,u,l,c,p=e.length,f=dt(t),d=[],h=0;for(;p>h;h++)if(o=e[h],o||0===o)if("object"===b.type(o))b.merge(d,o.nodeType?[o]:o);else if(wt.test(o)){s=s||f.appendChild(t.createElement("div")),u=(bt.exec(o)||["",""])[1].toLowerCase(),c=At[u]||At._default,s.innerHTML=c[1]+o.replace(vt,"<$1></$2>")+c[2],i=c[0];while(i--)s=s.lastChild;if(!b.support.leadingWhitespace&&yt.test(o)&&d.push(t.createTextNode(yt.exec(o)[0])),!b.support.tbody){o="table"!==u||xt.test(o)?"<table>"!==c[1]||xt.test(o)?0:s:s.firstChild,i=o&&o.childNodes.length;while(i--)b.nodeName(l=o.childNodes[i],"tbody")&&!l.childNodes.length&&o.removeChild(l)
}b.merge(d,s.childNodes),s.textContent="";while(s.firstChild)s.removeChild(s.firstChild);s=f.lastChild}else d.push(t.createTextNode(o));s&&f.removeChild(s),b.support.appendChecked||b.grep(Ot(d,"input"),Bt),h=0;while(o=d[h++])if((!r||-1===b.inArray(o,r))&&(a=b.contains(o.ownerDocument,o),s=Ot(f.appendChild(o),"script"),a&&Mt(s),n)){i=0;while(o=s[i++])kt.test(o.type||"")&&n.push(o)}return s=null,f},cleanData:function(e,t){var n,r,o,a,s=0,u=b.expando,l=b.cache,p=b.support.deleteExpando,f=b.event.special;for(;null!=(n=e[s]);s++)if((t||b.acceptData(n))&&(o=n[u],a=o&&l[o])){if(a.events)for(r in a.events)f[r]?b.event.remove(n,r):b.removeEvent(n,r,a.handle);l[o]&&(delete l[o],p?delete n[u]:typeof n.removeAttribute!==i?n.removeAttribute(u):n[u]=null,c.push(o))}}});var Pt,Rt,Wt,$t=/alpha\([^)]*\)/i,It=/opacity\s*=\s*([^)]*)/,zt=/^(top|right|bottom|left)$/,Xt=/^(none|table(?!-c[ea]).+)/,Ut=/^margin/,Vt=RegExp("^("+x+")(.*)$","i"),Yt=RegExp("^("+x+")(?!px)[a-z%]+$","i"),Jt=RegExp("^([+-])=("+x+")","i"),Gt={BODY:"block"},Qt={position:"absolute",visibility:"hidden",display:"block"},Kt={letterSpacing:0,fontWeight:400},Zt=["Top","Right","Bottom","Left"],en=["Webkit","O","Moz","ms"];function tn(e,t){if(t in e)return t;var n=t.charAt(0).toUpperCase()+t.slice(1),r=t,i=en.length;while(i--)if(t=en[i]+n,t in e)return t;return r}function nn(e,t){return e=t||e,"none"===b.css(e,"display")||!b.contains(e.ownerDocument,e)}function rn(e,t){var n,r,i,o=[],a=0,s=e.length;for(;s>a;a++)r=e[a],r.style&&(o[a]=b._data(r,"olddisplay"),n=r.style.display,t?(o[a]||"none"!==n||(r.style.display=""),""===r.style.display&&nn(r)&&(o[a]=b._data(r,"olddisplay",un(r.nodeName)))):o[a]||(i=nn(r),(n&&"none"!==n||!i)&&b._data(r,"olddisplay",i?n:b.css(r,"display"))));for(a=0;s>a;a++)r=e[a],r.style&&(t&&"none"!==r.style.display&&""!==r.style.display||(r.style.display=t?o[a]||"":"none"));return e}b.fn.extend({css:function(e,n){return b.access(this,function(e,n,r){var i,o,a={},s=0;if(b.isArray(n)){for(o=Rt(e),i=n.length;i>s;s++)a[n[s]]=b.css(e,n[s],!1,o);return a}return r!==t?b.style(e,n,r):b.css(e,n)},e,n,arguments.length>1)},show:function(){return rn(this,!0)},hide:function(){return rn(this)},toggle:function(e){var t="boolean"==typeof e;return this.each(function(){(t?e:nn(this))?b(this).show():b(this).hide()})}}),b.extend({cssHooks:{opacity:{get:function(e,t){if(t){var n=Wt(e,"opacity");return""===n?"1":n}}}},cssNumber:{columnCount:!0,fillOpacity:!0,fontWeight:!0,lineHeight:!0,opacity:!0,orphans:!0,widows:!0,zIndex:!0,zoom:!0},cssProps:{"float":b.support.cssFloat?"cssFloat":"styleFloat"},style:function(e,n,r,i){if(e&&3!==e.nodeType&&8!==e.nodeType&&e.style){var o,a,s,u=b.camelCase(n),l=e.style;if(n=b.cssProps[u]||(b.cssProps[u]=tn(l,u)),s=b.cssHooks[n]||b.cssHooks[u],r===t)return s&&"get"in s&&(o=s.get(e,!1,i))!==t?o:l[n];if(a=typeof r,"string"===a&&(o=Jt.exec(r))&&(r=(o[1]+1)*o[2]+parseFloat(b.css(e,n)),a="number"),!(null==r||"number"===a&&isNaN(r)||("number"!==a||b.cssNumber[u]||(r+="px"),b.support.clearCloneStyle||""!==r||0!==n.indexOf("background")||(l[n]="inherit"),s&&"set"in s&&(r=s.set(e,r,i))===t)))try{l[n]=r}catch(c){}}},css:function(e,n,r,i){var o,a,s,u=b.camelCase(n);return n=b.cssProps[u]||(b.cssProps[u]=tn(e.style,u)),s=b.cssHooks[n]||b.cssHooks[u],s&&"get"in s&&(a=s.get(e,!0,r)),a===t&&(a=Wt(e,n,i)),"normal"===a&&n in Kt&&(a=Kt[n]),""===r||r?(o=parseFloat(a),r===!0||b.isNumeric(o)?o||0:a):a},swap:function(e,t,n,r){var i,o,a={};for(o in t)a[o]=e.style[o],e.style[o]=t[o];i=n.apply(e,r||[]);for(o in t)e.style[o]=a[o];return i}}),e.getComputedStyle?(Rt=function(t){return e.getComputedStyle(t,null)},Wt=function(e,n,r){var i,o,a,s=r||Rt(e),u=s?s.getPropertyValue(n)||s[n]:t,l=e.style;return s&&(""!==u||b.contains(e.ownerDocument,e)||(u=b.style(e,n)),Yt.test(u)&&Ut.test(n)&&(i=l.width,o=l.minWidth,a=l.maxWidth,l.minWidth=l.maxWidth=l.width=u,u=s.width,l.width=i,l.minWidth=o,l.maxWidth=a)),u}):o.documentElement.currentStyle&&(Rt=function(e){return e.currentStyle},Wt=function(e,n,r){var i,o,a,s=r||Rt(e),u=s?s[n]:t,l=e.style;return null==u&&l&&l[n]&&(u=l[n]),Yt.test(u)&&!zt.test(n)&&(i=l.left,o=e.runtimeStyle,a=o&&o.left,a&&(o.left=e.currentStyle.left),l.left="fontSize"===n?"1em":u,u=l.pixelLeft+"px",l.left=i,a&&(o.left=a)),""===u?"auto":u});function on(e,t,n){var r=Vt.exec(t);return r?Math.max(0,r[1]-(n||0))+(r[2]||"px"):t}function an(e,t,n,r,i){var o=n===(r?"border":"content")?4:"width"===t?1:0,a=0;for(;4>o;o+=2)"margin"===n&&(a+=b.css(e,n+Zt[o],!0,i)),r?("content"===n&&(a-=b.css(e,"padding"+Zt[o],!0,i)),"margin"!==n&&(a-=b.css(e,"border"+Zt[o]+"Width",!0,i))):(a+=b.css(e,"padding"+Zt[o],!0,i),"padding"!==n&&(a+=b.css(e,"border"+Zt[o]+"Width",!0,i)));return a}function sn(e,t,n){var r=!0,i="width"===t?e.offsetWidth:e.offsetHeight,o=Rt(e),a=b.support.boxSizing&&"border-box"===b.css(e,"boxSizing",!1,o);if(0>=i||null==i){if(i=Wt(e,t,o),(0>i||null==i)&&(i=e.style[t]),Yt.test(i))return i;r=a&&(b.support.boxSizingReliable||i===e.style[t]),i=parseFloat(i)||0}return i+an(e,t,n||(a?"border":"content"),r,o)+"px"}function un(e){var t=o,n=Gt[e];return n||(n=ln(e,t),"none"!==n&&n||(Pt=(Pt||b("<iframe frameborder='0' width='0' height='0'/>").css("cssText","display:block !important")).appendTo(t.documentElement),t=(Pt[0].contentWindow||Pt[0].contentDocument).document,t.write("<!doctype html><html><body>"),t.close(),n=ln(e,t),Pt.detach()),Gt[e]=n),n}function ln(e,t){var n=b(t.createElement(e)).appendTo(t.body),r=b.css(n[0],"display");return n.remove(),r}b.each(["height","width"],function(e,n){b.cssHooks[n]={get:function(e,r,i){return r?0===e.offsetWidth&&Xt.test(b.css(e,"display"))?b.swap(e,Qt,function(){return sn(e,n,i)}):sn(e,n,i):t},set:function(e,t,r){var i=r&&Rt(e);return on(e,t,r?an(e,n,r,b.support.boxSizing&&"border-box"===b.css(e,"boxSizing",!1,i),i):0)}}}),b.support.opacity||(b.cssHooks.opacity={get:function(e,t){return It.test((t&&e.currentStyle?e.currentStyle.filter:e.style.filter)||"")?.01*parseFloat(RegExp.$1)+"":t?"1":""},set:function(e,t){var n=e.style,r=e.currentStyle,i=b.isNumeric(t)?"alpha(opacity="+100*t+")":"",o=r&&r.filter||n.filter||"";n.zoom=1,(t>=1||""===t)&&""===b.trim(o.replace($t,""))&&n.removeAttribute&&(n.removeAttribute("filter"),""===t||r&&!r.filter)||(n.filter=$t.test(o)?o.replace($t,i):o+" "+i)}}),b(function(){b.support.reliableMarginRight||(b.cssHooks.marginRight={get:function(e,n){return n?b.swap(e,{display:"inline-block"},Wt,[e,"marginRight"]):t}}),!b.support.pixelPosition&&b.fn.position&&b.each(["top","left"],function(e,n){b.cssHooks[n]={get:function(e,r){return r?(r=Wt(e,n),Yt.test(r)?b(e).position()[n]+"px":r):t}}})}),b.expr&&b.expr.filters&&(b.expr.filters.hidden=function(e){return 0>=e.offsetWidth&&0>=e.offsetHeight||!b.support.reliableHiddenOffsets&&"none"===(e.style&&e.style.display||b.css(e,"display"))},b.expr.filters.visible=function(e){return!b.expr.filters.hidden(e)}),b.each({margin:"",padding:"",border:"Width"},function(e,t){b.cssHooks[e+t]={expand:function(n){var r=0,i={},o="string"==typeof n?n.split(" "):[n];for(;4>r;r++)i[e+Zt[r]+t]=o[r]||o[r-2]||o[0];return i}},Ut.test(e)||(b.cssHooks[e+t].set=on)});var cn=/%20/g,pn=/\[\]$/,fn=/\r?\n/g,dn=/^(?:submit|button|image|reset|file)$/i,hn=/^(?:input|select|textarea|keygen)/i;b.fn.extend({serialize:function(){return b.param(this.serializeArray())},serializeArray:function(){return this.map(function(){var e=b.prop(this,"elements");return e?b.makeArray(e):this}).filter(function(){var e=this.type;return this.name&&!b(this).is(":disabled")&&hn.test(this.nodeName)&&!dn.test(e)&&(this.checked||!Nt.test(e))}).map(function(e,t){var n=b(this).val();return null==n?null:b.isArray(n)?b.map(n,function(e){return{name:t.name,value:e.replace(fn,"\r\n")}}):{name:t.name,value:n.replace(fn,"\r\n")}}).get()}}),b.param=function(e,n){var r,i=[],o=function(e,t){t=b.isFunction(t)?t():null==t?"":t,i[i.length]=encodeURIComponent(e)+"="+encodeURIComponent(t)};if(n===t&&(n=b.ajaxSettings&&b.ajaxSettings.traditional),b.isArray(e)||e.jquery&&!b.isPlainObject(e))b.each(e,function(){o(this.name,this.value)});else for(r in e)gn(r,e[r],n,o);return i.join("&").replace(cn,"+")};function gn(e,t,n,r){var i;if(b.isArray(t))b.each(t,function(t,i){n||pn.test(e)?r(e,i):gn(e+"["+("object"==typeof i?t:"")+"]",i,n,r)});else if(n||"object"!==b.type(t))r(e,t);else for(i in t)gn(e+"["+i+"]",t[i],n,r)}b.each("blur focus focusin focusout load resize scroll unload click dblclick mousedown mouseup mousemove mouseover mouseout mouseenter mouseleave change select submit keydown keypress keyup error contextmenu".split(" "),function(e,t){b.fn[t]=function(e,n){return arguments.length>0?this.on(t,null,e,n):this.trigger(t)}}),b.fn.hover=function(e,t){return this.mouseenter(e).mouseleave(t||e)};var mn,yn,vn=b.now(),bn=/\?/,xn=/#.*$/,wn=/([?&])_=[^&]*/,Tn=/^(.*?):[ \t]*([^\r\n]*)\r?$/gm,Nn=/^(?:about|app|app-storage|.+-extension|file|res|widget):$/,Cn=/^(?:GET|HEAD)$/,kn=/^\/\//,En=/^([\w.+-]+:)(?:\/\/([^\/?#:]*)(?::(\d+)|)|)/,Sn=b.fn.load,An={},jn={},Dn="*/".concat("*");try{yn=a.href}catch(Ln){yn=o.createElement("a"),yn.href="",yn=yn.href}mn=En.exec(yn.toLowerCase())||[];function Hn(e){return function(t,n){"string"!=typeof t&&(n=t,t="*");var r,i=0,o=t.toLowerCase().match(w)||[];if(b.isFunction(n))while(r=o[i++])"+"===r[0]?(r=r.slice(1)||"*",(e[r]=e[r]||[]).unshift(n)):(e[r]=e[r]||[]).push(n)}}function qn(e,n,r,i){var o={},a=e===jn;function s(u){var l;return o[u]=!0,b.each(e[u]||[],function(e,u){var c=u(n,r,i);return"string"!=typeof c||a||o[c]?a?!(l=c):t:(n.dataTypes.unshift(c),s(c),!1)}),l}return s(n.dataTypes[0])||!o["*"]&&s("*")}function Mn(e,n){var r,i,o=b.ajaxSettings.flatOptions||{};for(i in n)n[i]!==t&&((o[i]?e:r||(r={}))[i]=n[i]);return r&&b.extend(!0,e,r),e}b.fn.load=function(e,n,r){if("string"!=typeof e&&Sn)return Sn.apply(this,arguments);var i,o,a,s=this,u=e.indexOf(" ");return u>=0&&(i=e.slice(u,e.length),e=e.slice(0,u)),b.isFunction(n)?(r=n,n=t):n&&"object"==typeof n&&(a="POST"),s.length>0&&b.ajax({url:e,type:a,dataType:"html",data:n}).done(function(e){o=arguments,s.html(i?b("<div>").append(b.parseHTML(e)).find(i):e)}).complete(r&&function(e,t){s.each(r,o||[e.responseText,t,e])}),this},b.each(["ajaxStart","ajaxStop","ajaxComplete","ajaxError","ajaxSuccess","ajaxSend"],function(e,t){b.fn[t]=function(e){return this.on(t,e)}}),b.each(["get","post"],function(e,n){b[n]=function(e,r,i,o){return b.isFunction(r)&&(o=o||i,i=r,r=t),b.ajax({url:e,type:n,dataType:o,data:r,success:i})}}),b.extend({active:0,lastModified:{},etag:{},ajaxSettings:{url:yn,type:"GET",isLocal:Nn.test(mn[1]),global:!0,processData:!0,async:!0,contentType:"application/x-www-form-urlencoded; charset=UTF-8",accepts:{"*":Dn,text:"text/plain",html:"text/html",xml:"application/xml, text/xml",json:"application/json, text/javascript"},contents:{xml:/xml/,html:/html/,json:/json/},responseFields:{xml:"responseXML",text:"responseText"},converters:{"* text":e.String,"text html":!0,"text json":b.parseJSON,"text xml":b.parseXML},flatOptions:{url:!0,context:!0}},ajaxSetup:function(e,t){return t?Mn(Mn(e,b.ajaxSettings),t):Mn(b.ajaxSettings,e)},ajaxPrefilter:Hn(An),ajaxTransport:Hn(jn),ajax:function(e,n){"object"==typeof e&&(n=e,e=t),n=n||{};var r,i,o,a,s,u,l,c,p=b.ajaxSetup({},n),f=p.context||p,d=p.context&&(f.nodeType||f.jquery)?b(f):b.event,h=b.Deferred(),g=b.Callbacks("once memory"),m=p.statusCode||{},y={},v={},x=0,T="canceled",N={readyState:0,getResponseHeader:function(e){var t;if(2===x){if(!c){c={};while(t=Tn.exec(a))c[t[1].toLowerCase()]=t[2]}t=c[e.toLowerCase()]}return null==t?null:t},getAllResponseHeaders:function(){return 2===x?a:null},setRequestHeader:function(e,t){var n=e.toLowerCase();return x||(e=v[n]=v[n]||e,y[e]=t),this},overrideMimeType:function(e){return x||(p.mimeType=e),this},statusCode:function(e){var t;if(e)if(2>x)for(t in e)m[t]=[m[t],e[t]];else N.always(e[N.status]);return this},abort:function(e){var t=e||T;return l&&l.abort(t),k(0,t),this}};if(h.promise(N).complete=g.add,N.success=N.done,N.error=N.fail,p.url=((e||p.url||yn)+"").replace(xn,"").replace(kn,mn[1]+"//"),p.type=n.method||n.type||p.method||p.type,p.dataTypes=b.trim(p.dataType||"*").toLowerCase().match(w)||[""],null==p.crossDomain&&(r=En.exec(p.url.toLowerCase()),p.crossDomain=!(!r||r[1]===mn[1]&&r[2]===mn[2]&&(r[3]||("http:"===r[1]?80:443))==(mn[3]||("http:"===mn[1]?80:443)))),p.data&&p.processData&&"string"!=typeof p.data&&(p.data=b.param(p.data,p.traditional)),qn(An,p,n,N),2===x)return N;u=p.global,u&&0===b.active++&&b.event.trigger("ajaxStart"),p.type=p.type.toUpperCase(),p.hasContent=!Cn.test(p.type),o=p.url,p.hasContent||(p.data&&(o=p.url+=(bn.test(o)?"&":"?")+p.data,delete p.data),p.cache===!1&&(p.url=wn.test(o)?o.replace(wn,"$1_="+vn++):o+(bn.test(o)?"&":"?")+"_="+vn++)),p.ifModified&&(b.lastModified[o]&&N.setRequestHeader("If-Modified-Since",b.lastModified[o]),b.etag[o]&&N.setRequestHeader("If-None-Match",b.etag[o])),(p.data&&p.hasContent&&p.contentType!==!1||n.contentType)&&N.setRequestHeader("Content-Type",p.contentType),N.setRequestHeader("Accept",p.dataTypes[0]&&p.accepts[p.dataTypes[0]]?p.accepts[p.dataTypes[0]]+("*"!==p.dataTypes[0]?", "+Dn+"; q=0.01":""):p.accepts["*"]);for(i in p.headers)N.setRequestHeader(i,p.headers[i]);if(p.beforeSend&&(p.beforeSend.call(f,N,p)===!1||2===x))return N.abort();T="abort";for(i in{success:1,error:1,complete:1})N[i](p[i]);if(l=qn(jn,p,n,N)){N.readyState=1,u&&d.trigger("ajaxSend",[N,p]),p.async&&p.timeout>0&&(s=setTimeout(function(){N.abort("timeout")},p.timeout));try{x=1,l.send(y,k)}catch(C){if(!(2>x))throw C;k(-1,C)}}else k(-1,"No Transport");function k(e,n,r,i){var c,y,v,w,T,C=n;2!==x&&(x=2,s&&clearTimeout(s),l=t,a=i||"",N.readyState=e>0?4:0,r&&(w=_n(p,N,r)),e>=200&&300>e||304===e?(p.ifModified&&(T=N.getResponseHeader("Last-Modified"),T&&(b.lastModified[o]=T),T=N.getResponseHeader("etag"),T&&(b.etag[o]=T)),204===e?(c=!0,C="nocontent"):304===e?(c=!0,C="notmodified"):(c=Fn(p,w),C=c.state,y=c.data,v=c.error,c=!v)):(v=C,(e||!C)&&(C="error",0>e&&(e=0))),N.status=e,N.statusText=(n||C)+"",c?h.resolveWith(f,[y,C,N]):h.rejectWith(f,[N,C,v]),N.statusCode(m),m=t,u&&d.trigger(c?"ajaxSuccess":"ajaxError",[N,p,c?y:v]),g.fireWith(f,[N,C]),u&&(d.trigger("ajaxComplete",[N,p]),--b.active||b.event.trigger("ajaxStop")))}return N},getScript:function(e,n){return b.get(e,t,n,"script")},getJSON:function(e,t,n){return b.get(e,t,n,"json")}});function _n(e,n,r){var i,o,a,s,u=e.contents,l=e.dataTypes,c=e.responseFields;for(s in c)s in r&&(n[c[s]]=r[s]);while("*"===l[0])l.shift(),o===t&&(o=e.mimeType||n.getResponseHeader("Content-Type"));if(o)for(s in u)if(u[s]&&u[s].test(o)){l.unshift(s);break}if(l[0]in r)a=l[0];else{for(s in r){if(!l[0]||e.converters[s+" "+l[0]]){a=s;break}i||(i=s)}a=a||i}return a?(a!==l[0]&&l.unshift(a),r[a]):t}function Fn(e,t){var n,r,i,o,a={},s=0,u=e.dataTypes.slice(),l=u[0];if(e.dataFilter&&(t=e.dataFilter(t,e.dataType)),u[1])for(i in e.converters)a[i.toLowerCase()]=e.converters[i];for(;r=u[++s];)if("*"!==r){if("*"!==l&&l!==r){if(i=a[l+" "+r]||a["* "+r],!i)for(n in a)if(o=n.split(" "),o[1]===r&&(i=a[l+" "+o[0]]||a["* "+o[0]])){i===!0?i=a[n]:a[n]!==!0&&(r=o[0],u.splice(s--,0,r));break}if(i!==!0)if(i&&e["throws"])t=i(t);else try{t=i(t)}catch(c){return{state:"parsererror",error:i?c:"No conversion from "+l+" to "+r}}}l=r}return{state:"success",data:t}}b.ajaxSetup({accepts:{script:"text/javascript, application/javascript, application/ecmascript, application/x-ecmascript"},contents:{script:/(?:java|ecma)script/},converters:{"text script":function(e){return b.globalEval(e),e}}}),b.ajaxPrefilter("script",function(e){e.cache===t&&(e.cache=!1),e.crossDomain&&(e.type="GET",e.global=!1)}),b.ajaxTransport("script",function(e){if(e.crossDomain){var n,r=o.head||b("head")[0]||o.documentElement;return{send:function(t,i){n=o.createElement("script"),n.async=!0,e.scriptCharset&&(n.charset=e.scriptCharset),n.src=e.url,n.onload=n.onreadystatechange=function(e,t){(t||!n.readyState||/loaded|complete/.test(n.readyState))&&(n.onload=n.onreadystatechange=null,n.parentNode&&n.parentNode.removeChild(n),n=null,t||i(200,"success"))},r.insertBefore(n,r.firstChild)},abort:function(){n&&n.onload(t,!0)}}}});var On=[],Bn=/(=)\?(?=&|$)|\?\?/;b.ajaxSetup({jsonp:"callback",jsonpCallback:function(){var e=On.pop()||b.expando+"_"+vn++;return this[e]=!0,e}}),b.ajaxPrefilter("json jsonp",function(n,r,i){var o,a,s,u=n.jsonp!==!1&&(Bn.test(n.url)?"url":"string"==typeof n.data&&!(n.contentType||"").indexOf("application/x-www-form-urlencoded")&&Bn.test(n.data)&&"data");return u||"jsonp"===n.dataTypes[0]?(o=n.jsonpCallback=b.isFunction(n.jsonpCallback)?n.jsonpCallback():n.jsonpCallback,u?n[u]=n[u].replace(Bn,"$1"+o):n.jsonp!==!1&&(n.url+=(bn.test(n.url)?"&":"?")+n.jsonp+"="+o),n.converters["script json"]=function(){return s||b.error(o+" was not called"),s[0]},n.dataTypes[0]="json",a=e[o],e[o]=function(){s=arguments},i.always(function(){e[o]=a,n[o]&&(n.jsonpCallback=r.jsonpCallback,On.push(o)),s&&b.isFunction(a)&&a(s[0]),s=a=t}),"script"):t});var Pn,Rn,Wn=0,$n=e.ActiveXObject&&function(){var e;for(e in Pn)Pn[e](t,!0)};function In(){try{return new e.XMLHttpRequest}catch(t){}}function zn(){try{return new e.ActiveXObject("Microsoft.XMLHTTP")}catch(t){}}b.ajaxSettings.xhr=e.ActiveXObject?function(){return!this.isLocal&&In()||zn()}:In,Rn=b.ajaxSettings.xhr(),b.support.cors=!!Rn&&"withCredentials"in Rn,Rn=b.support.ajax=!!Rn,Rn&&b.ajaxTransport(function(n){if(!n.crossDomain||b.support.cors){var r;return{send:function(i,o){var a,s,u=n.xhr();if(n.username?u.open(n.type,n.url,n.async,n.username,n.password):u.open(n.type,n.url,n.async),n.xhrFields)for(s in n.xhrFields)u[s]=n.xhrFields[s];n.mimeType&&u.overrideMimeType&&u.overrideMimeType(n.mimeType),n.crossDomain||i["X-Requested-With"]||(i["X-Requested-With"]="XMLHttpRequest");try{for(s in i)u.setRequestHeader(s,i[s])}catch(l){}u.send(n.hasContent&&n.data||null),r=function(e,i){var s,l,c,p;try{if(r&&(i||4===u.readyState))if(r=t,a&&(u.onreadystatechange=b.noop,$n&&delete Pn[a]),i)4!==u.readyState&&u.abort();else{p={},s=u.status,l=u.getAllResponseHeaders(),"string"==typeof u.responseText&&(p.text=u.responseText);try{c=u.statusText}catch(f){c=""}s||!n.isLocal||n.crossDomain?1223===s&&(s=204):s=p.text?200:404}}catch(d){i||o(-1,d)}p&&o(s,c,p,l)},n.async?4===u.readyState?setTimeout(r):(a=++Wn,$n&&(Pn||(Pn={},b(e).unload($n)),Pn[a]=r),u.onreadystatechange=r):r()},abort:function(){r&&r(t,!0)}}}});var Xn,Un,Vn=/^(?:toggle|show|hide)$/,Yn=RegExp("^(?:([+-])=|)("+x+")([a-z%]*)$","i"),Jn=/queueHooks$/,Gn=[nr],Qn={"*":[function(e,t){var n,r,i=this.createTween(e,t),o=Yn.exec(t),a=i.cur(),s=+a||0,u=1,l=20;if(o){if(n=+o[2],r=o[3]||(b.cssNumber[e]?"":"px"),"px"!==r&&s){s=b.css(i.elem,e,!0)||n||1;do u=u||".5",s/=u,b.style(i.elem,e,s+r);while(u!==(u=i.cur()/a)&&1!==u&&--l)}i.unit=r,i.start=s,i.end=o[1]?s+(o[1]+1)*n:n}return i}]};function Kn(){return setTimeout(function(){Xn=t}),Xn=b.now()}function Zn(e,t){b.each(t,function(t,n){var r=(Qn[t]||[]).concat(Qn["*"]),i=0,o=r.length;for(;o>i;i++)if(r[i].call(e,t,n))return})}function er(e,t,n){var r,i,o=0,a=Gn.length,s=b.Deferred().always(function(){delete u.elem}),u=function(){if(i)return!1;var t=Xn||Kn(),n=Math.max(0,l.startTime+l.duration-t),r=n/l.duration||0,o=1-r,a=0,u=l.tweens.length;for(;u>a;a++)l.tweens[a].run(o);return s.notifyWith(e,[l,o,n]),1>o&&u?n:(s.resolveWith(e,[l]),!1)},l=s.promise({elem:e,props:b.extend({},t),opts:b.extend(!0,{specialEasing:{}},n),originalProperties:t,originalOptions:n,startTime:Xn||Kn(),duration:n.duration,tweens:[],createTween:function(t,n){var r=b.Tween(e,l.opts,t,n,l.opts.specialEasing[t]||l.opts.easing);return l.tweens.push(r),r},stop:function(t){var n=0,r=t?l.tweens.length:0;if(i)return this;for(i=!0;r>n;n++)l.tweens[n].run(1);return t?s.resolveWith(e,[l,t]):s.rejectWith(e,[l,t]),this}}),c=l.props;for(tr(c,l.opts.specialEasing);a>o;o++)if(r=Gn[o].call(l,e,c,l.opts))return r;return Zn(l,c),b.isFunction(l.opts.start)&&l.opts.start.call(e,l),b.fx.timer(b.extend(u,{elem:e,anim:l,queue:l.opts.queue})),l.progress(l.opts.progress).done(l.opts.done,l.opts.complete).fail(l.opts.fail).always(l.opts.always)}function tr(e,t){var n,r,i,o,a;for(i in e)if(r=b.camelCase(i),o=t[r],n=e[i],b.isArray(n)&&(o=n[1],n=e[i]=n[0]),i!==r&&(e[r]=n,delete e[i]),a=b.cssHooks[r],a&&"expand"in a){n=a.expand(n),delete e[r];for(i in n)i in e||(e[i]=n[i],t[i]=o)}else t[r]=o}b.Animation=b.extend(er,{tweener:function(e,t){b.isFunction(e)?(t=e,e=["*"]):e=e.split(" ");var n,r=0,i=e.length;for(;i>r;r++)n=e[r],Qn[n]=Qn[n]||[],Qn[n].unshift(t)},prefilter:function(e,t){t?Gn.unshift(e):Gn.push(e)}});function nr(e,t,n){var r,i,o,a,s,u,l,c,p,f=this,d=e.style,h={},g=[],m=e.nodeType&&nn(e);n.queue||(c=b._queueHooks(e,"fx"),null==c.unqueued&&(c.unqueued=0,p=c.empty.fire,c.empty.fire=function(){c.unqueued||p()}),c.unqueued++,f.always(function(){f.always(function(){c.unqueued--,b.queue(e,"fx").length||c.empty.fire()})})),1===e.nodeType&&("height"in t||"width"in t)&&(n.overflow=[d.overflow,d.overflowX,d.overflowY],"inline"===b.css(e,"display")&&"none"===b.css(e,"float")&&(b.support.inlineBlockNeedsLayout&&"inline"!==un(e.nodeName)?d.zoom=1:d.display="inline-block")),n.overflow&&(d.overflow="hidden",b.support.shrinkWrapBlocks||f.always(function(){d.overflow=n.overflow[0],d.overflowX=n.overflow[1],d.overflowY=n.overflow[2]}));for(i in t)if(a=t[i],Vn.exec(a)){if(delete t[i],u=u||"toggle"===a,a===(m?"hide":"show"))continue;g.push(i)}if(o=g.length){s=b._data(e,"fxshow")||b._data(e,"fxshow",{}),"hidden"in s&&(m=s.hidden),u&&(s.hidden=!m),m?b(e).show():f.done(function(){b(e).hide()}),f.done(function(){var t;b._removeData(e,"fxshow");for(t in h)b.style(e,t,h[t])});for(i=0;o>i;i++)r=g[i],l=f.createTween(r,m?s[r]:0),h[r]=s[r]||b.style(e,r),r in s||(s[r]=l.start,m&&(l.end=l.start,l.start="width"===r||"height"===r?1:0))}}function rr(e,t,n,r,i){return new rr.prototype.init(e,t,n,r,i)}b.Tween=rr,rr.prototype={constructor:rr,init:function(e,t,n,r,i,o){this.elem=e,this.prop=n,this.easing=i||"swing",this.options=t,this.start=this.now=this.cur(),this.end=r,this.unit=o||(b.cssNumber[n]?"":"px")},cur:function(){var e=rr.propHooks[this.prop];return e&&e.get?e.get(this):rr.propHooks._default.get(this)},run:function(e){var t,n=rr.propHooks[this.prop];return this.pos=t=this.options.duration?b.easing[this.easing](e,this.options.duration*e,0,1,this.options.duration):e,this.now=(this.end-this.start)*t+this.start,this.options.step&&this.options.step.call(this.elem,this.now,this),n&&n.set?n.set(this):rr.propHooks._default.set(this),this}},rr.prototype.init.prototype=rr.prototype,rr.propHooks={_default:{get:function(e){var t;return null==e.elem[e.prop]||e.elem.style&&null!=e.elem.style[e.prop]?(t=b.css(e.elem,e.prop,""),t&&"auto"!==t?t:0):e.elem[e.prop]},set:function(e){b.fx.step[e.prop]?b.fx.step[e.prop](e):e.elem.style&&(null!=e.elem.style[b.cssProps[e.prop]]||b.cssHooks[e.prop])?b.style(e.elem,e.prop,e.now+e.unit):e.elem[e.prop]=e.now}}},rr.propHooks.scrollTop=rr.propHooks.scrollLeft={set:function(e){e.elem.nodeType&&e.elem.parentNode&&(e.elem[e.prop]=e.now)}},b.each(["toggle","show","hide"],function(e,t){var n=b.fn[t];b.fn[t]=function(e,r,i){return null==e||"boolean"==typeof e?n.apply(this,arguments):this.animate(ir(t,!0),e,r,i)}}),b.fn.extend({fadeTo:function(e,t,n,r){return this.filter(nn).css("opacity",0).show().end().animate({opacity:t},e,n,r)},animate:function(e,t,n,r){var i=b.isEmptyObject(e),o=b.speed(t,n,r),a=function(){var t=er(this,b.extend({},e),o);a.finish=function(){t.stop(!0)},(i||b._data(this,"finish"))&&t.stop(!0)};return a.finish=a,i||o.queue===!1?this.each(a):this.queue(o.queue,a)},stop:function(e,n,r){var i=function(e){var t=e.stop;delete e.stop,t(r)};return"string"!=typeof e&&(r=n,n=e,e=t),n&&e!==!1&&this.queue(e||"fx",[]),this.each(function(){var t=!0,n=null!=e&&e+"queueHooks",o=b.timers,a=b._data(this);if(n)a[n]&&a[n].stop&&i(a[n]);else for(n in a)a[n]&&a[n].stop&&Jn.test(n)&&i(a[n]);for(n=o.length;n--;)o[n].elem!==this||null!=e&&o[n].queue!==e||(o[n].anim.stop(r),t=!1,o.splice(n,1));(t||!r)&&b.dequeue(this,e)})},finish:function(e){return e!==!1&&(e=e||"fx"),this.each(function(){var t,n=b._data(this),r=n[e+"queue"],i=n[e+"queueHooks"],o=b.timers,a=r?r.length:0;for(n.finish=!0,b.queue(this,e,[]),i&&i.cur&&i.cur.finish&&i.cur.finish.call(this),t=o.length;t--;)o[t].elem===this&&o[t].queue===e&&(o[t].anim.stop(!0),o.splice(t,1));for(t=0;a>t;t++)r[t]&&r[t].finish&&r[t].finish.call(this);delete n.finish})}});function ir(e,t){var n,r={height:e},i=0;for(t=t?1:0;4>i;i+=2-t)n=Zt[i],r["margin"+n]=r["padding"+n]=e;return t&&(r.opacity=r.width=e),r}b.each({slideDown:ir("show"),slideUp:ir("hide"),slideToggle:ir("toggle"),fadeIn:{opacity:"show"},fadeOut:{opacity:"hide"},fadeToggle:{opacity:"toggle"}},function(e,t){b.fn[e]=function(e,n,r){return this.animate(t,e,n,r)}}),b.speed=function(e,t,n){var r=e&&"object"==typeof e?b.extend({},e):{complete:n||!n&&t||b.isFunction(e)&&e,duration:e,easing:n&&t||t&&!b.isFunction(t)&&t};return r.duration=b.fx.off?0:"number"==typeof r.duration?r.duration:r.duration in b.fx.speeds?b.fx.speeds[r.duration]:b.fx.speeds._default,(null==r.queue||r.queue===!0)&&(r.queue="fx"),r.old=r.complete,r.complete=function(){b.isFunction(r.old)&&r.old.call(this),r.queue&&b.dequeue(this,r.queue)},r},b.easing={linear:function(e){return e},swing:function(e){return.5-Math.cos(e*Math.PI)/2}},b.timers=[],b.fx=rr.prototype.init,b.fx.tick=function(){var e,n=b.timers,r=0;for(Xn=b.now();n.length>r;r++)e=n[r],e()||n[r]!==e||n.splice(r--,1);n.length||b.fx.stop(),Xn=t},b.fx.timer=function(e){e()&&b.timers.push(e)&&b.fx.start()},b.fx.interval=13,b.fx.start=function(){Un||(Un=setInterval(b.fx.tick,b.fx.interval))},b.fx.stop=function(){clearInterval(Un),Un=null},b.fx.speeds={slow:600,fast:200,_default:400},b.fx.step={},b.expr&&b.expr.filters&&(b.expr.filters.animated=function(e){return b.grep(b.timers,function(t){return e===t.elem}).length}),b.fn.offset=function(e){if(arguments.length)return e===t?this:this.each(function(t){b.offset.setOffset(this,e,t)});var n,r,o={top:0,left:0},a=this[0],s=a&&a.ownerDocument;if(s)return n=s.documentElement,b.contains(n,a)?(typeof a.getBoundingClientRect!==i&&(o=a.getBoundingClientRect()),r=or(s),{top:o.top+(r.pageYOffset||n.scrollTop)-(n.clientTop||0),left:o.left+(r.pageXOffset||n.scrollLeft)-(n.clientLeft||0)}):o},b.offset={setOffset:function(e,t,n){var r=b.css(e,"position");"static"===r&&(e.style.position="relative");var i=b(e),o=i.offset(),a=b.css(e,"top"),s=b.css(e,"left"),u=("absolute"===r||"fixed"===r)&&b.inArray("auto",[a,s])>-1,l={},c={},p,f;u?(c=i.position(),p=c.top,f=c.left):(p=parseFloat(a)||0,f=parseFloat(s)||0),b.isFunction(t)&&(t=t.call(e,n,o)),null!=t.top&&(l.top=t.top-o.top+p),null!=t.left&&(l.left=t.left-o.left+f),"using"in t?t.using.call(e,l):i.css(l)}},b.fn.extend({position:function(){if(this[0]){var e,t,n={top:0,left:0},r=this[0];return"fixed"===b.css(r,"position")?t=r.getBoundingClientRect():(e=this.offsetParent(),t=this.offset(),b.nodeName(e[0],"html")||(n=e.offset()),n.top+=b.css(e[0],"borderTopWidth",!0),n.left+=b.css(e[0],"borderLeftWidth",!0)),{top:t.top-n.top-b.css(r,"marginTop",!0),left:t.left-n.left-b.css(r,"marginLeft",!0)}}},offsetParent:function(){return this.map(function(){var e=this.offsetParent||o.documentElement;while(e&&!b.nodeName(e,"html")&&"static"===b.css(e,"position"))e=e.offsetParent;return e||o.documentElement})}}),b.each({scrollLeft:"pageXOffset",scrollTop:"pageYOffset"},function(e,n){var r=/Y/.test(n);b.fn[e]=function(i){return b.access(this,function(e,i,o){var a=or(e);return o===t?a?n in a?a[n]:a.document.documentElement[i]:e[i]:(a?a.scrollTo(r?b(a).scrollLeft():o,r?o:b(a).scrollTop()):e[i]=o,t)},e,i,arguments.length,null)}});function or(e){return b.isWindow(e)?e:9===e.nodeType?e.defaultView||e.parentWindow:!1}b.each({Height:"height",Width:"width"},function(e,n){b.each({padding:"inner"+e,content:n,"":"outer"+e},function(r,i){b.fn[i]=function(i,o){var a=arguments.length&&(r||"boolean"!=typeof i),s=r||(i===!0||o===!0?"margin":"border");return b.access(this,function(n,r,i){var o;return b.isWindow(n)?n.document.documentElement["client"+e]:9===n.nodeType?(o=n.documentElement,Math.max(n.body["scroll"+e],o["scroll"+e],n.body["offset"+e],o["offset"+e],o["client"+e])):i===t?b.css(n,r,s):b.style(n,r,i,s)},n,a?i:t,a,null)}})}),e.jQuery=e.$=b,"function"==typeof define&&define.amd&&define.amd.jQuery&&define("jquery",[],function(){return b})})(window);
//     Underscore.js 1.5.2
//     http://underscorejs.org
//     (c) 2009-2013 Jeremy Ashkenas, DocumentCloud and Investigative Reporters & Editors
//     Underscore may be freely distributed under the MIT license.
(function(){var n=this,t=n._,r={},e=Array.prototype,u=Object.prototype,i=Function.prototype,a=e.push,o=e.slice,c=e.concat,l=u.toString,f=u.hasOwnProperty,s=e.forEach,p=e.map,h=e.reduce,v=e.reduceRight,g=e.filter,d=e.every,m=e.some,y=e.indexOf,b=e.lastIndexOf,x=Array.isArray,w=Object.keys,_=i.bind,j=function(n){return n instanceof j?n:this instanceof j?(this._wrapped=n,void 0):new j(n)};"undefined"!=typeof exports?("undefined"!=typeof module&&module.exports&&(exports=module.exports=j),exports._=j):n._=j,j.VERSION="1.5.2";var A=j.each=j.forEach=function(n,t,e){if(null!=n)if(s&&n.forEach===s)n.forEach(t,e);else if(n.length===+n.length){for(var u=0,i=n.length;i>u;u++)if(t.call(e,n[u],u,n)===r)return}else for(var a=j.keys(n),u=0,i=a.length;i>u;u++)if(t.call(e,n[a[u]],a[u],n)===r)return};j.map=j.collect=function(n,t,r){var e=[];return null==n?e:p&&n.map===p?n.map(t,r):(A(n,function(n,u,i){e.push(t.call(r,n,u,i))}),e)};var E="Reduce of empty array with no initial value";j.reduce=j.foldl=j.inject=function(n,t,r,e){var u=arguments.length>2;if(null==n&&(n=[]),h&&n.reduce===h)return e&&(t=j.bind(t,e)),u?n.reduce(t,r):n.reduce(t);if(A(n,function(n,i,a){u?r=t.call(e,r,n,i,a):(r=n,u=!0)}),!u)throw new TypeError(E);return r},j.reduceRight=j.foldr=function(n,t,r,e){var u=arguments.length>2;if(null==n&&(n=[]),v&&n.reduceRight===v)return e&&(t=j.bind(t,e)),u?n.reduceRight(t,r):n.reduceRight(t);var i=n.length;if(i!==+i){var a=j.keys(n);i=a.length}if(A(n,function(o,c,l){c=a?a[--i]:--i,u?r=t.call(e,r,n[c],c,l):(r=n[c],u=!0)}),!u)throw new TypeError(E);return r},j.find=j.detect=function(n,t,r){var e;return O(n,function(n,u,i){return t.call(r,n,u,i)?(e=n,!0):void 0}),e},j.filter=j.select=function(n,t,r){var e=[];return null==n?e:g&&n.filter===g?n.filter(t,r):(A(n,function(n,u,i){t.call(r,n,u,i)&&e.push(n)}),e)},j.reject=function(n,t,r){return j.filter(n,function(n,e,u){return!t.call(r,n,e,u)},r)},j.every=j.all=function(n,t,e){t||(t=j.identity);var u=!0;return null==n?u:d&&n.every===d?n.every(t,e):(A(n,function(n,i,a){return(u=u&&t.call(e,n,i,a))?void 0:r}),!!u)};var O=j.some=j.any=function(n,t,e){t||(t=j.identity);var u=!1;return null==n?u:m&&n.some===m?n.some(t,e):(A(n,function(n,i,a){return u||(u=t.call(e,n,i,a))?r:void 0}),!!u)};j.contains=j.include=function(n,t){return null==n?!1:y&&n.indexOf===y?n.indexOf(t)!=-1:O(n,function(n){return n===t})},j.invoke=function(n,t){var r=o.call(arguments,2),e=j.isFunction(t);return j.map(n,function(n){return(e?t:n[t]).apply(n,r)})},j.pluck=function(n,t){return j.map(n,function(n){return n[t]})},j.where=function(n,t,r){return j.isEmpty(t)?r?void 0:[]:j[r?"find":"filter"](n,function(n){for(var r in t)if(t[r]!==n[r])return!1;return!0})},j.findWhere=function(n,t){return j.where(n,t,!0)},j.max=function(n,t,r){if(!t&&j.isArray(n)&&n[0]===+n[0]&&n.length<65535)return Math.max.apply(Math,n);if(!t&&j.isEmpty(n))return-1/0;var e={computed:-1/0,value:-1/0};return A(n,function(n,u,i){var a=t?t.call(r,n,u,i):n;a>e.computed&&(e={value:n,computed:a})}),e.value},j.min=function(n,t,r){if(!t&&j.isArray(n)&&n[0]===+n[0]&&n.length<65535)return Math.min.apply(Math,n);if(!t&&j.isEmpty(n))return 1/0;var e={computed:1/0,value:1/0};return A(n,function(n,u,i){var a=t?t.call(r,n,u,i):n;a<e.computed&&(e={value:n,computed:a})}),e.value},j.shuffle=function(n){var t,r=0,e=[];return A(n,function(n){t=j.random(r++),e[r-1]=e[t],e[t]=n}),e},j.sample=function(n,t,r){return arguments.length<2||r?n[j.random(n.length-1)]:j.shuffle(n).slice(0,Math.max(0,t))};var k=function(n){return j.isFunction(n)?n:function(t){return t[n]}};j.sortBy=function(n,t,r){var e=k(t);return j.pluck(j.map(n,function(n,t,u){return{value:n,index:t,criteria:e.call(r,n,t,u)}}).sort(function(n,t){var r=n.criteria,e=t.criteria;if(r!==e){if(r>e||r===void 0)return 1;if(e>r||e===void 0)return-1}return n.index-t.index}),"value")};var F=function(n){return function(t,r,e){var u={},i=null==r?j.identity:k(r);return A(t,function(r,a){var o=i.call(e,r,a,t);n(u,o,r)}),u}};j.groupBy=F(function(n,t,r){(j.has(n,t)?n[t]:n[t]=[]).push(r)}),j.indexBy=F(function(n,t,r){n[t]=r}),j.countBy=F(function(n,t){j.has(n,t)?n[t]++:n[t]=1}),j.sortedIndex=function(n,t,r,e){r=null==r?j.identity:k(r);for(var u=r.call(e,t),i=0,a=n.length;a>i;){var o=i+a>>>1;r.call(e,n[o])<u?i=o+1:a=o}return i},j.toArray=function(n){return n?j.isArray(n)?o.call(n):n.length===+n.length?j.map(n,j.identity):j.values(n):[]},j.size=function(n){return null==n?0:n.length===+n.length?n.length:j.keys(n).length},j.first=j.head=j.take=function(n,t,r){return null==n?void 0:null==t||r?n[0]:o.call(n,0,t)},j.initial=function(n,t,r){return o.call(n,0,n.length-(null==t||r?1:t))},j.last=function(n,t,r){return null==n?void 0:null==t||r?n[n.length-1]:o.call(n,Math.max(n.length-t,0))},j.rest=j.tail=j.drop=function(n,t,r){return o.call(n,null==t||r?1:t)},j.compact=function(n){return j.filter(n,j.identity)};var M=function(n,t,r){return t&&j.every(n,j.isArray)?c.apply(r,n):(A(n,function(n){j.isArray(n)||j.isArguments(n)?t?a.apply(r,n):M(n,t,r):r.push(n)}),r)};j.flatten=function(n,t){return M(n,t,[])},j.without=function(n){return j.difference(n,o.call(arguments,1))},j.uniq=j.unique=function(n,t,r,e){j.isFunction(t)&&(e=r,r=t,t=!1);var u=r?j.map(n,r,e):n,i=[],a=[];return A(u,function(r,e){(t?e&&a[a.length-1]===r:j.contains(a,r))||(a.push(r),i.push(n[e]))}),i},j.union=function(){return j.uniq(j.flatten(arguments,!0))},j.intersection=function(n){var t=o.call(arguments,1);return j.filter(j.uniq(n),function(n){return j.every(t,function(t){return j.indexOf(t,n)>=0})})},j.difference=function(n){var t=c.apply(e,o.call(arguments,1));return j.filter(n,function(n){return!j.contains(t,n)})},j.zip=function(){for(var n=j.max(j.pluck(arguments,"length").concat(0)),t=new Array(n),r=0;n>r;r++)t[r]=j.pluck(arguments,""+r);return t},j.object=function(n,t){if(null==n)return{};for(var r={},e=0,u=n.length;u>e;e++)t?r[n[e]]=t[e]:r[n[e][0]]=n[e][1];return r},j.indexOf=function(n,t,r){if(null==n)return-1;var e=0,u=n.length;if(r){if("number"!=typeof r)return e=j.sortedIndex(n,t),n[e]===t?e:-1;e=0>r?Math.max(0,u+r):r}if(y&&n.indexOf===y)return n.indexOf(t,r);for(;u>e;e++)if(n[e]===t)return e;return-1},j.lastIndexOf=function(n,t,r){if(null==n)return-1;var e=null!=r;if(b&&n.lastIndexOf===b)return e?n.lastIndexOf(t,r):n.lastIndexOf(t);for(var u=e?r:n.length;u--;)if(n[u]===t)return u;return-1},j.range=function(n,t,r){arguments.length<=1&&(t=n||0,n=0),r=arguments[2]||1;for(var e=Math.max(Math.ceil((t-n)/r),0),u=0,i=new Array(e);e>u;)i[u++]=n,n+=r;return i};var R=function(){};j.bind=function(n,t){var r,e;if(_&&n.bind===_)return _.apply(n,o.call(arguments,1));if(!j.isFunction(n))throw new TypeError;return r=o.call(arguments,2),e=function(){if(!(this instanceof e))return n.apply(t,r.concat(o.call(arguments)));R.prototype=n.prototype;var u=new R;R.prototype=null;var i=n.apply(u,r.concat(o.call(arguments)));return Object(i)===i?i:u}},j.partial=function(n){var t=o.call(arguments,1);return function(){return n.apply(this,t.concat(o.call(arguments)))}},j.bindAll=function(n){var t=o.call(arguments,1);if(0===t.length)throw new Error("bindAll must be passed function names");return A(t,function(t){n[t]=j.bind(n[t],n)}),n},j.memoize=function(n,t){var r={};return t||(t=j.identity),function(){var e=t.apply(this,arguments);return j.has(r,e)?r[e]:r[e]=n.apply(this,arguments)}},j.delay=function(n,t){var r=o.call(arguments,2);return setTimeout(function(){return n.apply(null,r)},t)},j.defer=function(n){return j.delay.apply(j,[n,1].concat(o.call(arguments,1)))},j.throttle=function(n,t,r){var e,u,i,a=null,o=0;r||(r={});var c=function(){o=r.leading===!1?0:new Date,a=null,i=n.apply(e,u)};return function(){var l=new Date;o||r.leading!==!1||(o=l);var f=t-(l-o);return e=this,u=arguments,0>=f?(clearTimeout(a),a=null,o=l,i=n.apply(e,u)):a||r.trailing===!1||(a=setTimeout(c,f)),i}},j.debounce=function(n,t,r){var e,u,i,a,o;return function(){i=this,u=arguments,a=new Date;var c=function(){var l=new Date-a;t>l?e=setTimeout(c,t-l):(e=null,r||(o=n.apply(i,u)))},l=r&&!e;return e||(e=setTimeout(c,t)),l&&(o=n.apply(i,u)),o}},j.once=function(n){var t,r=!1;return function(){return r?t:(r=!0,t=n.apply(this,arguments),n=null,t)}},j.wrap=function(n,t){return function(){var r=[n];return a.apply(r,arguments),t.apply(this,r)}},j.compose=function(){var n=arguments;return function(){for(var t=arguments,r=n.length-1;r>=0;r--)t=[n[r].apply(this,t)];return t[0]}},j.after=function(n,t){return function(){return--n<1?t.apply(this,arguments):void 0}},j.keys=w||function(n){if(n!==Object(n))throw new TypeError("Invalid object");var t=[];for(var r in n)j.has(n,r)&&t.push(r);return t},j.values=function(n){for(var t=j.keys(n),r=t.length,e=new Array(r),u=0;r>u;u++)e[u]=n[t[u]];return e},j.pairs=function(n){for(var t=j.keys(n),r=t.length,e=new Array(r),u=0;r>u;u++)e[u]=[t[u],n[t[u]]];return e},j.invert=function(n){for(var t={},r=j.keys(n),e=0,u=r.length;u>e;e++)t[n[r[e]]]=r[e];return t},j.functions=j.methods=function(n){var t=[];for(var r in n)j.isFunction(n[r])&&t.push(r);return t.sort()},j.extend=function(n){return A(o.call(arguments,1),function(t){if(t)for(var r in t)n[r]=t[r]}),n},j.pick=function(n){var t={},r=c.apply(e,o.call(arguments,1));return A(r,function(r){r in n&&(t[r]=n[r])}),t},j.omit=function(n){var t={},r=c.apply(e,o.call(arguments,1));for(var u in n)j.contains(r,u)||(t[u]=n[u]);return t},j.defaults=function(n){return A(o.call(arguments,1),function(t){if(t)for(var r in t)n[r]===void 0&&(n[r]=t[r])}),n},j.clone=function(n){return j.isObject(n)?j.isArray(n)?n.slice():j.extend({},n):n},j.tap=function(n,t){return t(n),n};var S=function(n,t,r,e){if(n===t)return 0!==n||1/n==1/t;if(null==n||null==t)return n===t;n instanceof j&&(n=n._wrapped),t instanceof j&&(t=t._wrapped);var u=l.call(n);if(u!=l.call(t))return!1;switch(u){case"[object String]":return n==String(t);case"[object Number]":return n!=+n?t!=+t:0==n?1/n==1/t:n==+t;case"[object Date]":case"[object Boolean]":return+n==+t;case"[object RegExp]":return n.source==t.source&&n.global==t.global&&n.multiline==t.multiline&&n.ignoreCase==t.ignoreCase}if("object"!=typeof n||"object"!=typeof t)return!1;for(var i=r.length;i--;)if(r[i]==n)return e[i]==t;var a=n.constructor,o=t.constructor;if(a!==o&&!(j.isFunction(a)&&a instanceof a&&j.isFunction(o)&&o instanceof o))return!1;r.push(n),e.push(t);var c=0,f=!0;if("[object Array]"==u){if(c=n.length,f=c==t.length)for(;c--&&(f=S(n[c],t[c],r,e)););}else{for(var s in n)if(j.has(n,s)&&(c++,!(f=j.has(t,s)&&S(n[s],t[s],r,e))))break;if(f){for(s in t)if(j.has(t,s)&&!c--)break;f=!c}}return r.pop(),e.pop(),f};j.isEqual=function(n,t){return S(n,t,[],[])},j.isEmpty=function(n){if(null==n)return!0;if(j.isArray(n)||j.isString(n))return 0===n.length;for(var t in n)if(j.has(n,t))return!1;return!0},j.isElement=function(n){return!(!n||1!==n.nodeType)},j.isArray=x||function(n){return"[object Array]"==l.call(n)},j.isObject=function(n){return n===Object(n)},A(["Arguments","Function","String","Number","Date","RegExp"],function(n){j["is"+n]=function(t){return l.call(t)=="[object "+n+"]"}}),j.isArguments(arguments)||(j.isArguments=function(n){return!(!n||!j.has(n,"callee"))}),"function"!=typeof/./&&(j.isFunction=function(n){return"function"==typeof n}),j.isFinite=function(n){return isFinite(n)&&!isNaN(parseFloat(n))},j.isNaN=function(n){return j.isNumber(n)&&n!=+n},j.isBoolean=function(n){return n===!0||n===!1||"[object Boolean]"==l.call(n)},j.isNull=function(n){return null===n},j.isUndefined=function(n){return n===void 0},j.has=function(n,t){return f.call(n,t)},j.noConflict=function(){return n._=t,this},j.identity=function(n){return n},j.times=function(n,t,r){for(var e=Array(Math.max(0,n)),u=0;n>u;u++)e[u]=t.call(r,u);return e},j.random=function(n,t){return null==t&&(t=n,n=0),n+Math.floor(Math.random()*(t-n+1))};var I={escape:{"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#x27;"}};I.unescape=j.invert(I.escape);var T={escape:new RegExp("["+j.keys(I.escape).join("")+"]","g"),unescape:new RegExp("("+j.keys(I.unescape).join("|")+")","g")};j.each(["escape","unescape"],function(n){j[n]=function(t){return null==t?"":(""+t).replace(T[n],function(t){return I[n][t]})}}),j.result=function(n,t){if(null==n)return void 0;var r=n[t];return j.isFunction(r)?r.call(n):r},j.mixin=function(n){A(j.functions(n),function(t){var r=j[t]=n[t];j.prototype[t]=function(){var n=[this._wrapped];return a.apply(n,arguments),z.call(this,r.apply(j,n))}})};var N=0;j.uniqueId=function(n){var t=++N+"";return n?n+t:t},j.templateSettings={evaluate:/<%([\s\S]+?)%>/g,interpolate:/<%=([\s\S]+?)%>/g,escape:/<%-([\s\S]+?)%>/g};var q=/(.)^/,B={"'":"'","\\":"\\","\r":"r","\n":"n","	":"t","\u2028":"u2028","\u2029":"u2029"},D=/\\|'|\r|\n|\t|\u2028|\u2029/g;j.template=function(n,t,r){var e;r=j.defaults({},r,j.templateSettings);var u=new RegExp([(r.escape||q).source,(r.interpolate||q).source,(r.evaluate||q).source].join("|")+"|$","g"),i=0,a="__p+='";n.replace(u,function(t,r,e,u,o){return a+=n.slice(i,o).replace(D,function(n){return"\\"+B[n]}),r&&(a+="'+\n((__t=("+r+"))==null?'':_.escape(__t))+\n'"),e&&(a+="'+\n((__t=("+e+"))==null?'':__t)+\n'"),u&&(a+="';\n"+u+"\n__p+='"),i=o+t.length,t}),a+="';\n",r.variable||(a="with(obj||{}){\n"+a+"}\n"),a="var __t,__p='',__j=Array.prototype.join,"+"print=function(){__p+=__j.call(arguments,'');};\n"+a+"return __p;\n";try{e=new Function(r.variable||"obj","_",a)}catch(o){throw o.source=a,o}if(t)return e(t,j);var c=function(n){return e.call(this,n,j)};return c.source="function("+(r.variable||"obj")+"){\n"+a+"}",c},j.chain=function(n){return j(n).chain()};var z=function(n){return this._chain?j(n).chain():n};j.mixin(j),A(["pop","push","reverse","shift","sort","splice","unshift"],function(n){var t=e[n];j.prototype[n]=function(){var r=this._wrapped;return t.apply(r,arguments),"shift"!=n&&"splice"!=n||0!==r.length||delete r[0],z.call(this,r)}}),A(["concat","join","slice"],function(n){var t=e[n];j.prototype[n]=function(){return z.call(this,t.apply(this._wrapped,arguments))}}),j.extend(j.prototype,{chain:function(){return this._chain=!0,this},value:function(){return this._wrapped}})}).call(this);
//# sourceMappingURL=underscore-min.map;
define("underscore", (function (global) {
    return function () {
        var ret, fn;
        return ret || global._;
    };
}(this)));

(function(){var t=this;var e=t.Backbone;var i=[];var r=i.push;var s=i.slice;var n=i.splice;var a;if(typeof exports!=="undefined"){a=exports}else{a=t.Backbone={}}a.VERSION="1.1.0";var h=t._;if(!h&&typeof require!=="undefined")h=require("underscore");a.$=t.jQuery||t.Zepto||t.ender||t.$;a.noConflict=function(){t.Backbone=e;return this};a.emulateHTTP=false;a.emulateJSON=false;var o=a.Events={on:function(t,e,i){if(!l(this,"on",t,[e,i])||!e)return this;this._events||(this._events={});var r=this._events[t]||(this._events[t]=[]);r.push({callback:e,context:i,ctx:i||this});return this},once:function(t,e,i){if(!l(this,"once",t,[e,i])||!e)return this;var r=this;var s=h.once(function(){r.off(t,s);e.apply(this,arguments)});s._callback=e;return this.on(t,s,i)},off:function(t,e,i){var r,s,n,a,o,u,c,f;if(!this._events||!l(this,"off",t,[e,i]))return this;if(!t&&!e&&!i){this._events={};return this}a=t?[t]:h.keys(this._events);for(o=0,u=a.length;o<u;o++){t=a[o];if(n=this._events[t]){this._events[t]=r=[];if(e||i){for(c=0,f=n.length;c<f;c++){s=n[c];if(e&&e!==s.callback&&e!==s.callback._callback||i&&i!==s.context){r.push(s)}}}if(!r.length)delete this._events[t]}}return this},trigger:function(t){if(!this._events)return this;var e=s.call(arguments,1);if(!l(this,"trigger",t,e))return this;var i=this._events[t];var r=this._events.all;if(i)c(i,e);if(r)c(r,arguments);return this},stopListening:function(t,e,i){var r=this._listeningTo;if(!r)return this;var s=!e&&!i;if(!i&&typeof e==="object")i=this;if(t)(r={})[t._listenId]=t;for(var n in r){t=r[n];t.off(e,i,this);if(s||h.isEmpty(t._events))delete this._listeningTo[n]}return this}};var u=/\s+/;var l=function(t,e,i,r){if(!i)return true;if(typeof i==="object"){for(var s in i){t[e].apply(t,[s,i[s]].concat(r))}return false}if(u.test(i)){var n=i.split(u);for(var a=0,h=n.length;a<h;a++){t[e].apply(t,[n[a]].concat(r))}return false}return true};var c=function(t,e){var i,r=-1,s=t.length,n=e[0],a=e[1],h=e[2];switch(e.length){case 0:while(++r<s)(i=t[r]).callback.call(i.ctx);return;case 1:while(++r<s)(i=t[r]).callback.call(i.ctx,n);return;case 2:while(++r<s)(i=t[r]).callback.call(i.ctx,n,a);return;case 3:while(++r<s)(i=t[r]).callback.call(i.ctx,n,a,h);return;default:while(++r<s)(i=t[r]).callback.apply(i.ctx,e)}};var f={listenTo:"on",listenToOnce:"once"};h.each(f,function(t,e){o[e]=function(e,i,r){var s=this._listeningTo||(this._listeningTo={});var n=e._listenId||(e._listenId=h.uniqueId("l"));s[n]=e;if(!r&&typeof i==="object")r=this;e[t](i,r,this);return this}});o.bind=o.on;o.unbind=o.off;h.extend(a,o);var d=a.Model=function(t,e){var i=t||{};e||(e={});this.cid=h.uniqueId("c");this.attributes={};if(e.collection)this.collection=e.collection;if(e.parse)i=this.parse(i,e)||{};i=h.defaults({},i,h.result(this,"defaults"));this.set(i,e);this.changed={};this.initialize.apply(this,arguments)};h.extend(d.prototype,o,{changed:null,validationError:null,idAttribute:"id",initialize:function(){},toJSON:function(t){return h.clone(this.attributes)},sync:function(){return a.sync.apply(this,arguments)},get:function(t){return this.attributes[t]},escape:function(t){return h.escape(this.get(t))},has:function(t){return this.get(t)!=null},set:function(t,e,i){var r,s,n,a,o,u,l,c;if(t==null)return this;if(typeof t==="object"){s=t;i=e}else{(s={})[t]=e}i||(i={});if(!this._validate(s,i))return false;n=i.unset;o=i.silent;a=[];u=this._changing;this._changing=true;if(!u){this._previousAttributes=h.clone(this.attributes);this.changed={}}c=this.attributes,l=this._previousAttributes;if(this.idAttribute in s)this.id=s[this.idAttribute];for(r in s){e=s[r];if(!h.isEqual(c[r],e))a.push(r);if(!h.isEqual(l[r],e)){this.changed[r]=e}else{delete this.changed[r]}n?delete c[r]:c[r]=e}if(!o){if(a.length)this._pending=true;for(var f=0,d=a.length;f<d;f++){this.trigger("change:"+a[f],this,c[a[f]],i)}}if(u)return this;if(!o){while(this._pending){this._pending=false;this.trigger("change",this,i)}}this._pending=false;this._changing=false;return this},unset:function(t,e){return this.set(t,void 0,h.extend({},e,{unset:true}))},clear:function(t){var e={};for(var i in this.attributes)e[i]=void 0;return this.set(e,h.extend({},t,{unset:true}))},hasChanged:function(t){if(t==null)return!h.isEmpty(this.changed);return h.has(this.changed,t)},changedAttributes:function(t){if(!t)return this.hasChanged()?h.clone(this.changed):false;var e,i=false;var r=this._changing?this._previousAttributes:this.attributes;for(var s in t){if(h.isEqual(r[s],e=t[s]))continue;(i||(i={}))[s]=e}return i},previous:function(t){if(t==null||!this._previousAttributes)return null;return this._previousAttributes[t]},previousAttributes:function(){return h.clone(this._previousAttributes)},fetch:function(t){t=t?h.clone(t):{};if(t.parse===void 0)t.parse=true;var e=this;var i=t.success;t.success=function(r){if(!e.set(e.parse(r,t),t))return false;if(i)i(e,r,t);e.trigger("sync",e,r,t)};M(this,t);return this.sync("read",this,t)},save:function(t,e,i){var r,s,n,a=this.attributes;if(t==null||typeof t==="object"){r=t;i=e}else{(r={})[t]=e}i=h.extend({validate:true},i);if(r&&!i.wait){if(!this.set(r,i))return false}else{if(!this._validate(r,i))return false}if(r&&i.wait){this.attributes=h.extend({},a,r)}if(i.parse===void 0)i.parse=true;var o=this;var u=i.success;i.success=function(t){o.attributes=a;var e=o.parse(t,i);if(i.wait)e=h.extend(r||{},e);if(h.isObject(e)&&!o.set(e,i)){return false}if(u)u(o,t,i);o.trigger("sync",o,t,i)};M(this,i);s=this.isNew()?"create":i.patch?"patch":"update";if(s==="patch")i.attrs=r;n=this.sync(s,this,i);if(r&&i.wait)this.attributes=a;return n},destroy:function(t){t=t?h.clone(t):{};var e=this;var i=t.success;var r=function(){e.trigger("destroy",e,e.collection,t)};t.success=function(s){if(t.wait||e.isNew())r();if(i)i(e,s,t);if(!e.isNew())e.trigger("sync",e,s,t)};if(this.isNew()){t.success();return false}M(this,t);var s=this.sync("delete",this,t);if(!t.wait)r();return s},url:function(){var t=h.result(this,"urlRoot")||h.result(this.collection,"url")||U();if(this.isNew())return t;return t+(t.charAt(t.length-1)==="/"?"":"/")+encodeURIComponent(this.id)},parse:function(t,e){return t},clone:function(){return new this.constructor(this.attributes)},isNew:function(){return this.id==null},isValid:function(t){return this._validate({},h.extend(t||{},{validate:true}))},_validate:function(t,e){if(!e.validate||!this.validate)return true;t=h.extend({},this.attributes,t);var i=this.validationError=this.validate(t,e)||null;if(!i)return true;this.trigger("invalid",this,i,h.extend(e,{validationError:i}));return false}});var p=["keys","values","pairs","invert","pick","omit"];h.each(p,function(t){d.prototype[t]=function(){var e=s.call(arguments);e.unshift(this.attributes);return h[t].apply(h,e)}});var v=a.Collection=function(t,e){e||(e={});if(e.model)this.model=e.model;if(e.comparator!==void 0)this.comparator=e.comparator;this._reset();this.initialize.apply(this,arguments);if(t)this.reset(t,h.extend({silent:true},e))};var g={add:true,remove:true,merge:true};var m={add:true,remove:false};h.extend(v.prototype,o,{model:d,initialize:function(){},toJSON:function(t){return this.map(function(e){return e.toJSON(t)})},sync:function(){return a.sync.apply(this,arguments)},add:function(t,e){return this.set(t,h.extend({merge:false},e,m))},remove:function(t,e){var i=!h.isArray(t);t=i?[t]:h.clone(t);e||(e={});var r,s,n,a;for(r=0,s=t.length;r<s;r++){a=t[r]=this.get(t[r]);if(!a)continue;delete this._byId[a.id];delete this._byId[a.cid];n=this.indexOf(a);this.models.splice(n,1);this.length--;if(!e.silent){e.index=n;a.trigger("remove",a,this,e)}this._removeReference(a)}return i?t[0]:t},set:function(t,e){e=h.defaults({},e,g);if(e.parse)t=this.parse(t,e);var i=!h.isArray(t);t=i?t?[t]:[]:h.clone(t);var r,s,n,a,o,u,l;var c=e.at;var f=this.model;var p=this.comparator&&c==null&&e.sort!==false;var v=h.isString(this.comparator)?this.comparator:null;var m=[],y=[],_={};var w=e.add,b=e.merge,x=e.remove;var E=!p&&w&&x?[]:false;for(r=0,s=t.length;r<s;r++){o=t[r];if(o instanceof d){n=a=o}else{n=o[f.prototype.idAttribute]}if(u=this.get(n)){if(x)_[u.cid]=true;if(b){o=o===a?a.attributes:o;if(e.parse)o=u.parse(o,e);u.set(o,e);if(p&&!l&&u.hasChanged(v))l=true}t[r]=u}else if(w){a=t[r]=this._prepareModel(o,e);if(!a)continue;m.push(a);a.on("all",this._onModelEvent,this);this._byId[a.cid]=a;if(a.id!=null)this._byId[a.id]=a}if(E)E.push(u||a)}if(x){for(r=0,s=this.length;r<s;++r){if(!_[(a=this.models[r]).cid])y.push(a)}if(y.length)this.remove(y,e)}if(m.length||E&&E.length){if(p)l=true;this.length+=m.length;if(c!=null){for(r=0,s=m.length;r<s;r++){this.models.splice(c+r,0,m[r])}}else{if(E)this.models.length=0;var T=E||m;for(r=0,s=T.length;r<s;r++){this.models.push(T[r])}}}if(l)this.sort({silent:true});if(!e.silent){for(r=0,s=m.length;r<s;r++){(a=m[r]).trigger("add",a,this,e)}if(l||E&&E.length)this.trigger("sort",this,e)}return i?t[0]:t},reset:function(t,e){e||(e={});for(var i=0,r=this.models.length;i<r;i++){this._removeReference(this.models[i])}e.previousModels=this.models;this._reset();t=this.add(t,h.extend({silent:true},e));if(!e.silent)this.trigger("reset",this,e);return t},push:function(t,e){return this.add(t,h.extend({at:this.length},e))},pop:function(t){var e=this.at(this.length-1);this.remove(e,t);return e},unshift:function(t,e){return this.add(t,h.extend({at:0},e))},shift:function(t){var e=this.at(0);this.remove(e,t);return e},slice:function(){return s.apply(this.models,arguments)},get:function(t){if(t==null)return void 0;return this._byId[t.id]||this._byId[t.cid]||this._byId[t]},at:function(t){return this.models[t]},where:function(t,e){if(h.isEmpty(t))return e?void 0:[];return this[e?"find":"filter"](function(e){for(var i in t){if(t[i]!==e.get(i))return false}return true})},findWhere:function(t){return this.where(t,true)},sort:function(t){if(!this.comparator)throw new Error("Cannot sort a set without a comparator");t||(t={});if(h.isString(this.comparator)||this.comparator.length===1){this.models=this.sortBy(this.comparator,this)}else{this.models.sort(h.bind(this.comparator,this))}if(!t.silent)this.trigger("sort",this,t);return this},pluck:function(t){return h.invoke(this.models,"get",t)},fetch:function(t){t=t?h.clone(t):{};if(t.parse===void 0)t.parse=true;var e=t.success;var i=this;t.success=function(r){var s=t.reset?"reset":"set";i[s](r,t);if(e)e(i,r,t);i.trigger("sync",i,r,t)};M(this,t);return this.sync("read",this,t)},create:function(t,e){e=e?h.clone(e):{};if(!(t=this._prepareModel(t,e)))return false;if(!e.wait)this.add(t,e);var i=this;var r=e.success;e.success=function(t,e,s){if(s.wait)i.add(t,s);if(r)r(t,e,s)};t.save(null,e);return t},parse:function(t,e){return t},clone:function(){return new this.constructor(this.models)},_reset:function(){this.length=0;this.models=[];this._byId={}},_prepareModel:function(t,e){if(t instanceof d){if(!t.collection)t.collection=this;return t}e=e?h.clone(e):{};e.collection=this;var i=new this.model(t,e);if(!i.validationError)return i;this.trigger("invalid",this,i.validationError,e);return false},_removeReference:function(t){if(this===t.collection)delete t.collection;t.off("all",this._onModelEvent,this)},_onModelEvent:function(t,e,i,r){if((t==="add"||t==="remove")&&i!==this)return;if(t==="destroy")this.remove(e,r);if(e&&t==="change:"+e.idAttribute){delete this._byId[e.previous(e.idAttribute)];if(e.id!=null)this._byId[e.id]=e}this.trigger.apply(this,arguments)}});var y=["forEach","each","map","collect","reduce","foldl","inject","reduceRight","foldr","find","detect","filter","select","reject","every","all","some","any","include","contains","invoke","max","min","toArray","size","first","head","take","initial","rest","tail","drop","last","without","difference","indexOf","shuffle","lastIndexOf","isEmpty","chain"];h.each(y,function(t){v.prototype[t]=function(){var e=s.call(arguments);e.unshift(this.models);return h[t].apply(h,e)}});var _=["groupBy","countBy","sortBy"];h.each(_,function(t){v.prototype[t]=function(e,i){var r=h.isFunction(e)?e:function(t){return t.get(e)};return h[t](this.models,r,i)}});var w=a.View=function(t){this.cid=h.uniqueId("view");t||(t={});h.extend(this,h.pick(t,x));this._ensureElement();this.initialize.apply(this,arguments);this.delegateEvents()};var b=/^(\S+)\s*(.*)$/;var x=["model","collection","el","id","attributes","className","tagName","events"];h.extend(w.prototype,o,{tagName:"div",$:function(t){return this.$el.find(t)},initialize:function(){},render:function(){return this},remove:function(){this.$el.remove();this.stopListening();return this},setElement:function(t,e){if(this.$el)this.undelegateEvents();this.$el=t instanceof a.$?t:a.$(t);this.el=this.$el[0];if(e!==false)this.delegateEvents();return this},delegateEvents:function(t){if(!(t||(t=h.result(this,"events"))))return this;this.undelegateEvents();for(var e in t){var i=t[e];if(!h.isFunction(i))i=this[t[e]];if(!i)continue;var r=e.match(b);var s=r[1],n=r[2];i=h.bind(i,this);s+=".delegateEvents"+this.cid;if(n===""){this.$el.on(s,i)}else{this.$el.on(s,n,i)}}return this},undelegateEvents:function(){this.$el.off(".delegateEvents"+this.cid);return this},_ensureElement:function(){if(!this.el){var t=h.extend({},h.result(this,"attributes"));if(this.id)t.id=h.result(this,"id");if(this.className)t["class"]=h.result(this,"className");var e=a.$("<"+h.result(this,"tagName")+">").attr(t);this.setElement(e,false)}else{this.setElement(h.result(this,"el"),false)}}});a.sync=function(t,e,i){var r=T[t];h.defaults(i||(i={}),{emulateHTTP:a.emulateHTTP,emulateJSON:a.emulateJSON});var s={type:r,dataType:"json"};if(!i.url){s.url=h.result(e,"url")||U()}if(i.data==null&&e&&(t==="create"||t==="update"||t==="patch")){s.contentType="application/json";s.data=JSON.stringify(i.attrs||e.toJSON(i))}if(i.emulateJSON){s.contentType="application/x-www-form-urlencoded";s.data=s.data?{model:s.data}:{}}if(i.emulateHTTP&&(r==="PUT"||r==="DELETE"||r==="PATCH")){s.type="POST";if(i.emulateJSON)s.data._method=r;var n=i.beforeSend;i.beforeSend=function(t){t.setRequestHeader("X-HTTP-Method-Override",r);if(n)return n.apply(this,arguments)}}if(s.type!=="GET"&&!i.emulateJSON){s.processData=false}if(s.type==="PATCH"&&E){s.xhr=function(){return new ActiveXObject("Microsoft.XMLHTTP")}}var o=i.xhr=a.ajax(h.extend(s,i));e.trigger("request",e,o,i);return o};var E=typeof window!=="undefined"&&!!window.ActiveXObject&&!(window.XMLHttpRequest&&(new XMLHttpRequest).dispatchEvent);var T={create:"POST",update:"PUT",patch:"PATCH","delete":"DELETE",read:"GET"};a.ajax=function(){return a.$.ajax.apply(a.$,arguments)};var k=a.Router=function(t){t||(t={});if(t.routes)this.routes=t.routes;this._bindRoutes();this.initialize.apply(this,arguments)};var S=/\((.*?)\)/g;var $=/(\(\?)?:\w+/g;var H=/\*\w+/g;var A=/[\-{}\[\]+?.,\\\^$|#\s]/g;h.extend(k.prototype,o,{initialize:function(){},route:function(t,e,i){if(!h.isRegExp(t))t=this._routeToRegExp(t);if(h.isFunction(e)){i=e;e=""}if(!i)i=this[e];var r=this;a.history.route(t,function(s){var n=r._extractParameters(t,s);i&&i.apply(r,n);r.trigger.apply(r,["route:"+e].concat(n));r.trigger("route",e,n);a.history.trigger("route",r,e,n)});return this},navigate:function(t,e){a.history.navigate(t,e);return this},_bindRoutes:function(){if(!this.routes)return;this.routes=h.result(this,"routes");var t,e=h.keys(this.routes);while((t=e.pop())!=null){this.route(t,this.routes[t])}},_routeToRegExp:function(t){t=t.replace(A,"\\$&").replace(S,"(?:$1)?").replace($,function(t,e){return e?t:"([^/]+)"}).replace(H,"(.*?)");return new RegExp("^"+t+"$")},_extractParameters:function(t,e){var i=t.exec(e).slice(1);return h.map(i,function(t){return t?decodeURIComponent(t):null})}});var I=a.History=function(){this.handlers=[];h.bindAll(this,"checkUrl");if(typeof window!=="undefined"){this.location=window.location;this.history=window.history}};var N=/^[#\/]|\s+$/g;var O=/^\/+|\/+$/g;var P=/msie [\w.]+/;var C=/\/$/;var j=/[?#].*$/;I.started=false;h.extend(I.prototype,o,{interval:50,getHash:function(t){var e=(t||this).location.href.match(/#(.*)$/);return e?e[1]:""},getFragment:function(t,e){if(t==null){if(this._hasPushState||!this._wantsHashChange||e){t=this.location.pathname;var i=this.root.replace(C,"");if(!t.indexOf(i))t=t.slice(i.length)}else{t=this.getHash()}}return t.replace(N,"")},start:function(t){if(I.started)throw new Error("Backbone.history has already been started");I.started=true;this.options=h.extend({root:"/"},this.options,t);this.root=this.options.root;this._wantsHashChange=this.options.hashChange!==false;this._wantsPushState=!!this.options.pushState;this._hasPushState=!!(this.options.pushState&&this.history&&this.history.pushState);var e=this.getFragment();var i=document.documentMode;var r=P.exec(navigator.userAgent.toLowerCase())&&(!i||i<=7);this.root=("/"+this.root+"/").replace(O,"/");if(r&&this._wantsHashChange){this.iframe=a.$('<iframe src="javascript:0" tabindex="-1" />').hide().appendTo("body")[0].contentWindow;this.navigate(e)}if(this._hasPushState){a.$(window).on("popstate",this.checkUrl)}else if(this._wantsHashChange&&"onhashchange"in window&&!r){a.$(window).on("hashchange",this.checkUrl)}else if(this._wantsHashChange){this._checkUrlInterval=setInterval(this.checkUrl,this.interval)}this.fragment=e;var s=this.location;var n=s.pathname.replace(/[^\/]$/,"$&/")===this.root;if(this._wantsHashChange&&this._wantsPushState){if(!this._hasPushState&&!n){this.fragment=this.getFragment(null,true);this.location.replace(this.root+this.location.search+"#"+this.fragment);return true}else if(this._hasPushState&&n&&s.hash){this.fragment=this.getHash().replace(N,"");this.history.replaceState({},document.title,this.root+this.fragment+s.search)}}if(!this.options.silent)return this.loadUrl()},stop:function(){a.$(window).off("popstate",this.checkUrl).off("hashchange",this.checkUrl);clearInterval(this._checkUrlInterval);I.started=false},route:function(t,e){this.handlers.unshift({route:t,callback:e})},checkUrl:function(t){var e=this.getFragment();if(e===this.fragment&&this.iframe){e=this.getFragment(this.getHash(this.iframe))}if(e===this.fragment)return false;if(this.iframe)this.navigate(e);this.loadUrl()},loadUrl:function(t){t=this.fragment=this.getFragment(t);return h.any(this.handlers,function(e){if(e.route.test(t)){e.callback(t);return true}})},navigate:function(t,e){if(!I.started)return false;if(!e||e===true)e={trigger:!!e};var i=this.root+(t=this.getFragment(t||""));t=t.replace(j,"");if(this.fragment===t)return;this.fragment=t;if(t===""&&i!=="/")i=i.slice(0,-1);if(this._hasPushState){this.history[e.replace?"replaceState":"pushState"]({},document.title,i)}else if(this._wantsHashChange){this._updateHash(this.location,t,e.replace);if(this.iframe&&t!==this.getFragment(this.getHash(this.iframe))){if(!e.replace)this.iframe.document.open().close();this._updateHash(this.iframe.location,t,e.replace)}}else{return this.location.assign(i)}if(e.trigger)return this.loadUrl(t)},_updateHash:function(t,e,i){if(i){var r=t.href.replace(/(javascript:|#).*$/,"");t.replace(r+"#"+e)}else{t.hash="#"+e}}});a.history=new I;var R=function(t,e){var i=this;var r;if(t&&h.has(t,"constructor")){r=t.constructor}else{r=function(){return i.apply(this,arguments)}}h.extend(r,i,e);var s=function(){this.constructor=r};s.prototype=i.prototype;r.prototype=new s;if(t)h.extend(r.prototype,t);r.__super__=i.prototype;return r};d.extend=v.extend=k.extend=w.extend=I.extend=R;var U=function(){throw new Error('A "url" property or function must be specified')};var M=function(t,e){var i=e.error;e.error=function(r){if(i)i(t,r,e);t.trigger("error",t,r,e)}}}).call(this);
//# sourceMappingURL=backbone-min.map;
define("Backbone", ["underscore","jquery"], (function (global) {
    return function () {
        var ret, fn;
        return ret || global.Backbone;
    };
}(this)));

!function(a){var b,c,d,e,f,g,h,i,j,k,l,m,n,o,p,q,r,s,t,u,v,w,x,y,z,A,B,C,D,E,F,G,H,I,J,K,L,M,N,O,P,Q,R,S,T,U,V,W,X,Y,Z,$,_,ab,bb,cb,db,eb,fb,gb,hb,ib,jb,kb,lb,mb,nb,ob,pb,qb,rb,sb,tb,ub="0.3.7",vb=a.document||null,wb={},xb={},yb={},zb={},Ab={}.hasOwnProperty,Bb=function(){},Cb=a.console||{log:Bb,warn:Bb},Db=/^\s+/,Eb=/\s+$/,Fb="Missing Ractive.parse - cannot parse template. Either preparse or use the version that includes the parser",Gb=1,Hb=2,Ib=3,Jb=4,Kb=5,Lb=6,Mb=7,Nb=8,Ob=9,Pb=10,Qb=11,Rb=12,Sb=15,Tb=20,Ub=21,Vb=22,Wb=23,Xb=24,Yb=26,Zb=27,$b=30,_b=31,ac=32,bc=33,cc=34,dc=35,ec=36,fc=40,gc=vb?vb.createElement("div"):null,hc={html:"http://www.w3.org/1999/xhtml",mathml:"http://www.w3.org/1998/Math/MathML",svg:"http://www.w3.org/2000/svg",xlink:"http://www.w3.org/1999/xlink",xml:"http://www.w3.org/XML/1998/namespace",xmlns:"http://www.w3.org/2000/xmlns/"};try{try{Object.defineProperty({},"test",{value:0}),Object.defineProperties({},{test:{value:0}})}catch(ic){throw tb=!0,ic}vb&&(Object.defineProperty(gc,"test",{value:0}),Object.defineProperties(gc,{test:{value:0}})),E=Object.defineProperty,F=Object.defineProperties}catch(ic){E=function(a,b,c){a[b]=c.value},F=function(a,b){var c;for(c in b)b.hasOwnProperty(c)&&E(a,c,b[c])}}try{Object.create(null),G=Object.create,H=function(){return Object.create(null)}}catch(ic){G=function(){var a=function(){};return function(b,c){var d;return a.prototype=b,d=new a,c&&Object.defineProperties(d,c),d}}(),H=function(){return{}}}var jc,kc,lc,mc=function(a){return a.replace(/[A-Z]/g,function(a){return"-"+a.toLowerCase()})};!function(){vb&&(void 0!==gc.style.transition?(kc="transition",lc="transitionend",jc=!0):void 0!==gc.style.webkitTransition?(kc="webkitTransition",lc="webkitTransitionEnd",jc=!0):jc=!1)}(),a.Node&&!a.Node.prototype.contains&&a.HTMLElement&&a.HTMLElement.prototype.contains&&(a.Node.prototype.contains=a.HTMLElement.prototype.contains),function(a){var b=a.document;b&&(Date.now||(Date.now=function(){return+new Date}),b&&!b.createElementNS&&(b.createElementNS=function(a,c){if(a&&"http://www.w3.org/1999/xhtml"!==a)throw"This browser does not support namespaces other than http://www.w3.org/1999/xhtml";return b.createElement(c)}),String.prototype.trim||(String.prototype.trim=function(){return this.replace(/^\s+/,"").replace(/\s+$/,"")}),Object.keys||(Object.keys=function(){var a=Object.prototype.hasOwnProperty,b=!{toString:null}.propertyIsEnumerable("toString"),c=["toString","toLocaleString","valueOf","hasOwnProperty","isPrototypeOf","propertyIsEnumerable","constructor"],d=c.length;return function(e){if("object"!=typeof e&&"function"!=typeof e||null===e)throw new TypeError("Object.keys called on non-object");var f=[];for(var g in e)a.call(e,g)&&f.push(g);if(b)for(var h=0;d>h;h++)a.call(e,c[h])&&f.push(c[h]);return f}}()),Array.prototype.indexOf||(Array.prototype.indexOf=function(a,b){var c;for(void 0===b&&(b=0),0>b&&(b+=this.length),0>b&&(b=0),c=this.length;c>b;b++)if(Ab.call(this,b)&&this[b]===a)return b;return-1}),Array.prototype.forEach||(Array.prototype.forEach=function(a,b){var c,d;for(c=0,d=this.length;d>c;c+=1)Ab.call(this,c)&&a.call(b,this[c],c,this)}),Array.prototype.map||(Array.prototype.map=function(a,b){var c,d,e=[];for(c=0,d=this.length;d>c;c+=1)Ab.call(this,c)&&(e[c]=a.call(b,this[c],c,this));return e}),Array.prototype.filter||(Array.prototype.filter=function(a,b){var c,d,e=[];for(c=0,d=this.length;d>c;c+=1)Ab.call(this,c)&&a.call(b,this[c],c,this)&&(e[e.length]=this[c]);return e}),a.addEventListener||function(a,b){var c,d,e,f,g;c=function(a,b){var c,d=this;for(c in a)d[c]=a[c];d.currentTarget=b,d.target=a.srcElement||b,d.timeStamp=+new Date,d.preventDefault=function(){a.returnValue=!1},d.stopPropagation=function(){a.cancelBubble=!0}},d=function(a,b){var d,e,f=this;d=f.listeners||(f.listeners=[]),e=d.length,d[e]=[b,function(a){b.call(f,new c(a,f))}],f.attachEvent("on"+a,d[e][1])},e=function(a,b){var c,d,e=this;if(e.listeners)for(c=e.listeners,d=c.length;d--;)c[d][0]===b&&e.detachEvent("on"+a,c[d][1])},a.addEventListener=b.addEventListener=d,a.removeEventListener=b.removeEventListener=e,"Element"in a?(Element.prototype.addEventListener=d,Element.prototype.removeEventListener=e):(f=b.getElementsByTagName("head")[0],g=b.createElement("style"),f.insertBefore(g,f.firstChild),g.styleSheet.cssText="*{-ms-event-prototype:expression(!this.addEventListener&&(this.addEventListener=addEventListener)&&(this.removeEventListener=removeEventListener))}")}(a,b))}(a),function(){var a,b,c,d,e,f,g,h,i,j,k;P=function(){var b,d,e,f=this.parentNode;return this.fragment?(b=a(this))?(this.interpolator=b,this.keypath=b.keypath||b.descriptor.r,(d=c(this))?(f._ractive.binding=d,this.twoway=!0,e=this.root._twowayBindings[this.keypath]||(this.root._twowayBindings[this.keypath]=[]),e[e.length]=d,!0):!1):!1:!1},b=function(){this._ractive.binding.update()},a=function(a){var b;return 1!==a.fragment.items.length?null:(b=a.fragment.items[0],b.type!==Hb?null:b.keypath||b.ref?b:null)},c=function(a){var b=a.parentNode;if("SELECT"===b.tagName)return b.multiple?new e(a,b):new f(a,b);if("checkbox"===b.type||"radio"===b.type){if("name"===a.propertyName){if("checkbox"===b.type)return new h(a,b);if("radio"===b.type)return new g(a,b)}return"checked"===a.propertyName?new i(a,b):null}return"value"!==a.propertyName&&Cb.warn("This is... odd"),"file"===a.parentNode.type?new j(a,b):new k(a,b)},e=function(a,c){var e;d(this,a,c),c.addEventListener("change",b,!1),e=this.root.get(this.keypath),void 0===e&&this.update()},e.prototype={value:function(){var a,b,c,d;for(a=[],b=this.node.options,d=b.length,c=0;d>c;c+=1)b[c].selected&&(a[a.length]=b[c]._ractive.value);return a},update:function(){var a,b,c;a=this.attr,b=a.value,c=this.value(),void 0!==b&&Ac(c,b)||(a.receiving=!0,a.value=c,this.root.set(this.keypath,c),a.receiving=!1)},teardown:function(){this.node.removeEventListener("change",b,!1)}},f=function(a,c){var e;d(this,a,c),c.addEventListener("change",b,!1),e=this.root.get(this.keypath),void 0===e&&this.update()},f.prototype={value:function(){var a,b,c;for(a=this.node.options,c=a.length,b=0;c>b;b+=1)if(a[b].selected)return a[b]._ractive.value},update:function(){var a=this.value();this.attr.receiving=!0,this.attr.value=a,this.root.set(this.keypath,a),this.attr.receiving=!1},teardown:function(){this.node.removeEventListener("change",b,!1)}},g=function(a,c){var e;this.radioName=!0,d(this,a,c),c.name="{{"+a.keypath+"}}",c.addEventListener("change",b,!1),c.attachEvent&&c.addEventListener("click",b,!1),e=this.root.get(this.keypath),void 0!==e?c.checked=e===c._ractive.value:this.root._defRadios[this.root._defRadios.length]=this},g.prototype={value:function(){return this.node._ractive?this.node._ractive.value:this.node.value},update:function(){var a=this.node;a.checked&&(this.attr.receiving=!0,this.root.set(this.keypath,this.value()),this.attr.receiving=!1)},teardown:function(){this.node.removeEventListener("change",b,!1),this.node.removeEventListener("click",b,!1)}},h=function(a,c){var e,f;this.checkboxName=!0,d(this,a,c),c.name="{{"+this.keypath+"}}",c.addEventListener("change",b,!1),c.attachEvent&&c.addEventListener("click",b,!1),e=this.root.get(this.keypath),void 0!==e?(f=-1!==e.indexOf(c._ractive.value),c.checked=f):-1===this.root._defCheckboxes.indexOf(this.keypath)&&(this.root._defCheckboxes[this.root._defCheckboxes.length]=this.keypath)},h.prototype={changed:function(){return this.node.checked!==!!this.checked},update:function(){this.checked=this.node.checked,this.attr.receiving=!0,this.root.set(this.keypath,vc(this.root,this.keypath)),this.attr.receiving=!1},teardown:function(){this.node.removeEventListener("change",b,!1),this.node.removeEventListener("click",b,!1)}},i=function(a,c){d(this,a,c),c.addEventListener("change",b,!1),c.attachEvent&&c.addEventListener("click",b,!1)},i.prototype={value:function(){return this.node.checked},update:function(){this.attr.receiving=!0,this.root.set(this.keypath,this.value()),this.attr.receiving=!1},teardown:function(){this.node.removeEventListener("change",b,!1),this.node.removeEventListener("click",b,!1)}},j=function(a,c){d(this,a,c),c.addEventListener("change",b,!1)},j.prototype={value:function(){return this.attr.parentNode.files},update:function(){this.attr.root.set(this.attr.keypath,this.value())},teardown:function(){this.node.removeEventListener("change",b,!1)}},k=function(a,c){d(this,a,c),c.addEventListener("change",b,!1),this.root.lazy||(c.addEventListener("input",b,!1),c.attachEvent&&c.addEventListener("keyup",b,!1))},k.prototype={value:function(){var a=this.attr.parentNode.value;return+a+""===a&&-1===a.indexOf("e")&&(a=+a),a},update:function(){var a=this.attr,b=this.value();a.receiving=!0,a.root.set(a.keypath,b),a.receiving=!1},teardown:function(){this.node.removeEventListener("change",b,!1),this.node.removeEventListener("input",b,!1),this.node.removeEventListener("keyup",b,!1)}},d=function(a,b,c){a.attr=b,a.node=c,a.root=b.root,a.keypath=b.keypath}}(),function(){var a,b,c,d,e,f,g,h;O=function(){var d;if(!this.ready)return this;if(d=this.parentNode,"SELECT"===d.tagName&&"value"===this.name)return this.update=b,this.deferredUpdate=c,this.update();if(this.isFileInputValue)return this.update=a,this;if(this.twoway&&"name"===this.name){if("radio"===d.type)return this.update=f,this.update();if("checkbox"===d.type)return this.update=g,this.update()}return this.update=h,this.update()},a=function(){return this},c=function(){this.deferredUpdate=this.parentNode.multiple?e:d,this.deferredUpdate()},b=function(){return this.root._defSelectValues.push(this),this},d=function(){var a,b,c,d=this.fragment.getValue();for(this.value=d,a=this.parentNode.options,c=a.length;c--;)if(b=a[c],b._ractive.value===d)return b.selected=!0,this;return this},e=function(){var a,b,c=this.fragment.getValue();for(r(c)||(c=[c]),a=this.parentNode.options,b=a.length;b--;)a[b].selected=-1!==c.indexOf(a[b]._ractive.value);return this.value=c,this},f=function(){var a,b;return a=this.parentNode,b=this.fragment.getValue(),a.checked=b===a._ractive.value,this},g=function(){var a,b;return a=this.parentNode,b=this.fragment.getValue(),r(b)?(a.checked=-1!==b.indexOf(a._ractive.value),this):(a.checked=b===a._ractive.value,this)},h=function(){var a,b;if(a=this.parentNode,b=this.fragment.getValue(),this.isValueAttribute&&(a._ractive.value=b),void 0===b&&(b=""),b!==this.value){if(this.useProperty)return this.receiving||(a[this.propertyName]=b),this.value=b,this;if(this.namespace)return a.setAttributeNS(this.namespace,this.name,b),this.value=b,this;"id"===this.name&&(void 0!==this.value&&(this.root.nodes[this.value]=void 0),this.root.nodes[b]=a),a.setAttribute(this.name,b),this.value=b}return this}}(),I=function(a,b){var c,d,e;for(d in b)if(Ab.call(b,d))for(e=d.split("-"),c=e.length;c--;)J(a,e[c],b[d],a.parentFragment.contextStack)},function(){var a,c,d,e,f,g,h,i;J=function(b,c,d,e,f){var g,h;g=b.ractify().events,h=g[c]||(g[c]=new a(b,c,e,f)),h.add(d)},a=function(a,c,d){var e;this.element=a,this.root=a.root,this.node=a.node,this.name=c,this.contextStack=d,this.proxies=[],(e=this.root.eventDefinitions[c]||b.eventDefinitions[c])?this.custom=e(this.node,i(c)):this.node.addEventListener(c,h,!1)},a.prototype={add:function(a){this.proxies[this.proxies.length]=new c(this.element,this.root,a,this.contextStack)},teardown:function(){var a;for(this.custom?this.custom.teardown():this.node.removeEventListener(this.name,h,!1),a=this.proxies.length;a--;)this.proxies[a].teardown()},fire:function(a){for(var b=this.proxies.length;b--;)this.proxies[b].fire(a)}},c=function(a,b,c,g){var h;return this.root=b,h=c.n||c,this.n="string"==typeof h?h:new Z({descriptor:c.n,root:this.root,owner:a,contextStack:g}),c.a?(this.a=c.a,this.fire=e,void 0):c.d?(this.d=new Z({descriptor:c.d,root:this.root,owner:a,contextStack:g}),this.fire=f,void 0):(this.fire=d,void 0)},c.prototype={teardown:function(){this.n.teardown&&this.n.teardown(),this.d&&this.d.teardown()},bubble:Bb},d=function(a){this.root.fire(this.n.toString(),a)},e=function(a){this.root.fire(this.n.toString(),a,this.a)},f=function(a){this.root.fire(this.n.toString(),a,this.d.toJSON())},h=function(a){var b=this._ractive;b.events[a.type].fire({node:this,original:a,index:b.index,keypath:b.keypath,context:b.root.get(b.keypath)})},g={},i=function(a){return g[a]?g[a]:g[a]=function(b){var c=b.node._ractive;b.index=c.index,b.keypath=c.keypath,b.context=c.root.get(c.keypath),c.events[a].fire(b)}}}(),K=function(a,b,c,d){"string"!=typeof c.f||b&&b.namespaceURI&&b.namespaceURI!==hc.html?"style"===c.e&&void 0!==b.styleSheet?(a.fragment=new Z({descriptor:c.f,root:a.root,contextStack:a.parentFragment.contextStack,owner:a}),d&&(a.bubble=function(){b.styleSheet.cssText=a.fragment.toString()})):(a.fragment=new Q({descriptor:c.f,root:a.root,parentNode:b,contextStack:a.parentFragment.contextStack,owner:a}),d&&b.appendChild(a.fragment.docFrag)):(a.html=c.f,d&&(b.innerHTML=a.html))},L=function(a,b){switch(a.ractify(),a.descriptor.e){case"select":case"textarea":return b.value&&b.value.bind(),void 0;case"input":if("radio"===a.node.type||"checkbox"===a.node.type){if(b.name&&b.name.bind())return;if(b.checked&&b.checked.bind())return}if(b.value&&b.value.bind())return}},M=function(a,b){var c,d,e;a.attributes=[];for(c in b)Ab.call(b,c)&&(d=b[c],e=new S({element:a,name:c,value:d,root:a.root,parentNode:a.node,contextStack:a.parentFragment.contextStack}),a.attributes[a.attributes.length]=e,("value"===c||"name"===c||"checked"===c)&&(a.attributes[c]=e),"name"!==c&&e.update());return a.attributes},N=function(a,b){return a.a&&a.a.xmlns?a.a.xmlns:"svg"===a.e.toLowerCase()?hc.svg:b.namespaceURI},y=function(a,c,d,e,f){var g,h,i,j,k;c.transitionsEnabled&&("string"==typeof a?g=a:(g=a.n,a.a?h=a.a:a.d&&(i=new Z({descriptor:a.d,root:c,owner:d,contextStack:d.parentFragment.contextStack}),h=i.toJSON(),i.teardown())),k=c.transitions[g]||b.transitions[g],k&&(j=c._transitionManager,j.push(d.node),k.call(c,d.node,function(){j.pop(d.node)},h,f)))},A=function(a,b){return a.components[b]},function(){var a={};w=function(b,c,d){var e,f=[];for(e=a[c]||(a[c]=vb.createElement(c)),e.innerHTML=b;e.firstChild;)f[f.length]=e.firstChild,d.appendChild(e.firstChild);return f}}(),function(){var a,b,c;x=function(b,c,d,e,f){var g,h,i,j,k,l,m;for(i=c.descriptor.i,g=d;e>g;g+=1)h=c.fragments[g],j=g-f,k=g,l=c.keypath+"."+(g-f),m=c.keypath+"."+g,h.index+=f,a(h,i,j,k,f,l,m);p(b)},a=function(d,e,f,g,h,i,j){var k,l,m;for(d.indexRefs&&void 0!==d.indexRefs[e]&&(d.indexRefs[e]=g),k=d.contextStack.length;k--;)m=d.contextStack[k],m.substr(0,i.length)===i&&(d.contextStack[k]=m.replace(i,j));for(k=d.items.length;k--;)switch(l=d.items[k],l.type){case Mb:b(l,e,f,g,h,i,j);break;case Nb:a(l.fragment,e,f,g,h,i,j);break;case Jb:case Hb:case Ib:c(l,e,f,g,h,i,j)}},b=function(b,c,d,e,f,g,h){var i,j,k,l,m,n;for(i=b.attributes.length;i--;)j=b.attributes[i],j.fragment&&(a(j.fragment,c,d,e,f,g,h),j.twoway&&j.updateBindings());if(k=b.node._ractive){k.keypath.substr(0,g.length)===g&&(k.keypath=k.keypath.replace(g,h)),void 0!==c&&(k.index[c]=e);for(l in k.events)for(m=k.events[l].proxies,i=m.length;i--;)n=m[i],"object"==typeof n.n&&a(n.a,c,d,e,f,g,h),n.d&&a(n.d,c,d,e,f,g,h);k.binding&&k.binding.keypath.substr(0,g.length)===g&&(k.binding.keypath=k.binding.keypath.replace(g,h))}b.fragment&&a(b.fragment,c,d,e,f,g,h)},c=function(b,c,d,e,f,g,h){var i;if(b.descriptor.x&&(b.keypath&&k(b),b.expressionResolver&&b.expressionResolver.teardown(),b.expressionResolver=new bb(b)),b.keypath?b.keypath.substr(0,g.length)===g&&b.resolve(b.keypath.replace(g,h)):b.indexRef===c&&(b.value=e,b.render(e)),b.fragments)for(i=b.fragments.length;i--;)a(b.fragments[i],c,d,e,f,g,h)}}(),function(a){var b,c,d,e,f;cb=function(a,c,e,f,g){var h,i;for(this.root=a,this.keypath=c,this.priority=g,this.dependants=0,this.fn=d(e,f.length),this.values=[],this.refs=[],h=f.length;h--;)(i=f[h])?i[0]?this.values[h]=i[1]:this.refs[this.refs.length]=new b(a,i[1],this,h,g):this.values[h]=void 0;this.selfUpdating=this.refs.length<=1},cb.prototype={wake:function(){this.awake=!0,this.update()},sleep:function(){this.awake=!1},bubble:function(){this.awake&&(this.selfUpdating?this.update():this.deferred||(this.root._defEvals[this.root._defEvals.length]=this,this.deferred=!0))},update:function(){var a;if(this.evaluating)return this;this.evaluating=!0;try{a=this.fn.apply(null,this.values)}catch(b){if(this.root.debug)throw b;a=void 0}return u(a,this.value)||(i(this.root,this.keypath),this.root._cache[this.keypath]=a,l(this.root,this.keypath),this.value=a),this.evaluating=!1,this},teardown:function(){for(;this.refs.length;)this.refs.pop().teardown();i(this.root,this.keypath),this.root._evaluators[this.keypath]=null},refresh:function(){this.selfUpdating||(this.deferred=!0);for(var a=this.refs.length;a--;)this.refs[a].update();this.deferred&&(this.update(),this.deferred=!1)},updateSoftDependencies:function(a){var b,d,e;for(this.softRefs||(this.softRefs=[]),b=this.softRefs.length;b--;)e=this.softRefs[b],a[e.keypath]||(this.softRefs.splice(b,1),this.softRefs[e.keypath]=!1,e.teardown());for(b=a.length;b--;)d=a[b],this.softRefs[d]||(e=new c(this.root,d,this),this.softRefs[this.softRefs.length]=e,this.softRefs[d]=!0);this.selfUpdating=this.refs.length+this.softRefs.length<=1}},b=function(a,b,c,d,e){var g;this.evaluator=c,this.keypath=b,this.root=a,this.argNum=d,this.type=$b,this.priority=e,g=a.get(b),"function"==typeof g&&(g=g._wrapped||f(g,a,c)),this.value=c.values[d]=g,j(this)},b.prototype={update:function(){var a=this.root.get(this.keypath);"function"!=typeof a||a._nowrap||(a=a["_"+this.root._guid]||f(a,this.root,this.evaluator)),u(a,this.value)||(this.evaluator.values[this.argNum]=a,this.evaluator.bubble(),this.value=a)},teardown:function(){k(this)}},c=function(a,b,c){this.root=a,this.keypath=b,this.priority=c.priority,this.evaluator=c,j(this)},c.prototype={update:function(){var a=this.root.get(this.keypath);u(a,this.value)||(this.evaluator.bubble(),this.value=a)},teardown:function(){k(this)}},d=function(b,c){var d,e;if(b=b.replace(/\$\{([0-9]+)\}/g,"_$1"),a[b])return a[b];for(e=[];c--;)e[c]="_"+c;return d=new Function(e.join(","),"return("+b+")"),a[b]=d,d},e=/this/,f=function(a,b,c){var d;if(!e.test(a.toString()))return E(a,"_nowrap",{value:!0}),a;E(a,"_"+b._guid,{value:function(){var d,e,f;return d=b.get,b.get=function(a){return f||(f=[]),f[a]||(f[f.length]=a,f[a]=!0),d.call(b,a)},e=a.apply(b,arguments),f&&c.updateSoftDependencies(f),b.get=d,e},writable:!0});for(d in a)Ab.call(a,d)&&(a["_"+b._guid][d]=a[d]);return a["_"+b._guid]}}({}),function(){var a,b;bb=function(b){var c,d,e,f,g;if(this.root=b.root,this.mustache=b,this.args=[],this.scouts=[],c=b.descriptor.x,g=b.parentFragment.indexRefs,this.str=c.s,e=this.unresolved=this.args.length=c.r?c.r.length:0,!e)return this.resolved=this.ready=!0,this.bubble(),void 0;for(d=0;e>d;d+=1)f=c.r[d],g&&void 0!==g[f]?this.resolveRef(d,!0,g[f]):this.scouts[this.scouts.length]=new a(this,f,b.contextStack,d);this.ready=!0,this.bubble()},bb.prototype={bubble:function(){this.ready&&(this.keypath=b(this.str,this.args),this.createEvaluator(),this.mustache.resolve(this.keypath))},teardown:function(){for(;this.scouts.length;)this.scouts.pop().teardown()},resolveRef:function(a,b,c){this.args[a]=[b,c],this.bubble(),this.resolved=!--this.unresolved},createEvaluator:function(){this.root._evaluators[this.keypath]?this.root._evaluators[this.keypath].refresh():this.root._evaluators[this.keypath]=new cb(this.root,this.keypath,this.str,this.args,this.mustache.priority)}},a=function(a,b,c,d){var e,f;f=this.root=a.root,e=o(f,b,c),e?a.resolveRef(d,!1,e):(this.ref=b,this.argNum=d,this.resolver=a,this.contextStack=c,f._pendingResolution[f._pendingResolution.length]=this)},a.prototype={resolve:function(a){this.keypath=a,this.resolver.resolveRef(this.argNum,!1,a)},teardown:function(){this.keypath||h(this)}},b=function(a,b){var c;return c=a.replace(/\$\{([0-9]+)\}/g,function(a,c){return b[c]?b[c][1]:"undefined"}),"("+c.replace(/[\.\[\]]/g,"-")+")"}}(),function(){var a,c;z=function(d,e){var f,g;if(g=a(d,e))return g;if(g=a(b,e))return g;if(vb&&(f=vb.getElementById(e),f&&"SCRIPT"===f.tagName)){if(!b.parse)throw new Error(Fb);b.partials[e]=b.parse(f.innerHTML)}return g=b.partials[e],g?c(g):(d.debug&&Cb&&Cb.warn&&Cb.warn('Could not find descriptor for partial "'+e+'"'),[])},a=function(a,d){var e,f;if(a.partials[d]){if("string"==typeof a.partials[d]){if(!b.parse)throw new Error(Fb);if(e=b.parse(a.partials[d],a.parseOptions),s(e)){a.partials[d]=e.main;for(f in e.partials)e.partials.hasOwnProperty(f)&&(a.partials[f]=e.partials[f])}else a.partials[d]=e}return c(a.partials[d])}},c=function(a){return 1===a.length&&"string"==typeof a[0]?a[0]:a}}(),ib=function(a,b){var c,d,e,f,g;if(a.owner=b.owner,e=a.owner.parentFragment,a.root=b.root,a.parentNode=b.parentNode,a.contextStack=b.contextStack||[],a.owner.type===Jb&&(a.index=b.index),e&&(f=e.indexRefs)){a.indexRefs=H();for(g in f)a.indexRefs[g]=f[g]}for(a.priority=e?e.priority+1:1,b.indexRef&&(a.indexRefs||(a.indexRefs={}),a.indexRefs[b.indexRef]=b.index),a.items=[],c=b.descriptor?b.descriptor.length:0,d=0;c>d;d+=1)a.items[a.items.length]=a.createItem({parentFragment:a,descriptor:b.descriptor[d],index:d})},B=function(a){var b,c,d;for(b=a.items.length;b--;)if(c=a.items[b],c.type!==Gb){if(c.type!==Hb)return!1;if(d)return!1;d=!0}return!0},fb=function(a,b){var c,d,e;e=a.parentFragment=b.parentFragment,a.root=e.root,a.contextStack=e.contextStack,a.descriptor=b.descriptor,a.index=b.index||0,a.priority=e.priority,e.parentNode&&(a.parentNode=e.parentNode),a.type=b.descriptor.t,b.descriptor.r&&(e.indexRefs&&void 0!==e.indexRefs[b.descriptor.r]?(d=e.indexRefs[b.descriptor.r],a.indexRef=b.descriptor.r,a.value=d,a.render(a.value)):(c=o(a.root,b.descriptor.r,a.contextStack),c?a.resolve(c):(a.ref=b.descriptor.r,a.root._pendingResolution[a.root._pendingResolution.length]=a,a.descriptor.n&&a.render(!1)))),b.descriptor.x&&(a.expressionResolver=new bb(a))},gb=function(){var a=this.root.get(this.keypath,!0);u(a,this.value)||(this.render(a),this.value=a)},hb=function(a){this.resolved&&k(this),this.keypath=a,j(this),this.update(),this.expressionResolver&&this.expressionResolver.resolved&&(this.expressionResolver=null),this.resolved=!0},function(){var a,b,c,d;jb=function(e,f){var g;return g={descriptor:e.descriptor.f,root:e.root,parentNode:e.parentNode,owner:e},e.descriptor.n?(d(e,f,!0,g),void 0):(r(f)?a(e,f,g):s(f)?e.descriptor.i?b(e,f,g):c(e,g):d(e,f,!1,g),void 0)},a=function(a,b,c){var d,e,f;if(e=b.length,e<a.length)for(f=a.fragments.splice(e,a.length-e);f.length;)f.pop().teardown(!0);else if(e>a.length)for(d=a.length;e>d;d+=1)c.contextStack=a.contextStack.concat(a.keypath+"."+d),c.index=d,a.descriptor.i&&(c.indexRef=a.descriptor.i),a.fragments[d]=a.createFragment(c);a.length=e},b=function(a,b,c){var d,e;e=a.fragmentsById||(a.fragmentsById=H());for(d in e)void 0===b[d]&&e[d]&&(e[d].teardown(!0),e[d]=null);for(d in b)void 0===b[d]||e[d]||(c.contextStack=a.contextStack.concat(a.keypath+"."+d),c.index=d,a.descriptor.i&&(c.indexRef=a.descriptor.i),e[d]=a.createFragment(c))},c=function(a,b){a.length||(b.contextStack=a.contextStack.concat(a.keypath),b.index=0,a.fragments[0]=a.createFragment(b),a.length=1)},d=function(a,b,c,d){var e,f,g;if(f=r(b)&&0===b.length,e=c?f||!b:b&&!f){if(a.length||(d.contextStack=a.contextStack,d.index=0,a.fragments[0]=a.createFragment(d),a.length=1),a.length>1)for(g=a.fragments.splice(1);g.length;)g.pop().teardown(!0)}else a.length&&(a.teardownFragments(!0),a.length=0)}}();var nc;!function(){var a,b,c;nc=function(d,e){return d.next()?a(d,e)||b(d,e)||c(d,e):null},a=function(a,b){var c=a.next();return c.type===Gb?(a.pos+=1,new Hc(c,b)):null},b=function(a,b){var c=a.next();return c.type===Qb||c.type===Ib?c.mustacheType===Jb||c.mustacheType===Kb?new Gc(c,a,b):new Fc(c,a):null},c=function(a,b){var c,d=a.next();return d.type===Rb?(c=new Cc(d,a,b),a.options.sanitize&&a.options.sanitize.elements&&-1!==a.options.sanitize.elements.indexOf(c.lcTag)?null:c):null}}();var oc=function(a,b){var c,d;return b||(c=pc(a),c===!1)?d=a.map(function(a){return a.toJSON(b)}):c},pc=function(a){var b,c,d,e="";if(!a)return"";for(c=0,d=a.length;d>c;c+=1){if(b=a[c].toString(),b===!1)return!1;e+=b}return e},qc=function(a){var b=Db.exec(a.str.substring(a.pos));return b?(a.pos+=b[0].length,b[0]):null},rc=function(a,b){var c=a.remaining().substr(0,40);throw 40===c.length&&(c+="..."),new Error('Tokenizer failed: unexpected string "'+c+'" (expected '+b+")")},sc=function(a){return function(b){var c=a.exec(b.str.substring(b.pos));return c?(b.pos+=c[0].length,c[1]||c[0]):null}},tc=function(a,b){var c;return c=a.str.substr(a.pos,b.length),c===b?(a.pos+=b.length,b):null};qb=function(a){var b,c,d,e;for(b=0;b<a.length;b+=1)c=a[b],d=a[b-1],e=a[b+1],(c.mustacheType===Ob||c.mustacheType===Pb)&&(a.splice(b,1),d&&e&&d.type===Gb&&e.type===Gb&&(d.value+=e.value,a.splice(b,1)),b-=1);return a},rb=function(a){var b,c,d;for(d="";a.length;){if(b=a.indexOf("<!--"),c=a.indexOf("-->"),-1===b&&-1===c){d+=a;break}if(-1!==b&&-1===c)throw"Illegal HTML - expected closing comment sequence ('-->')";if(-1!==c&&-1===b||b>c)throw"Illegal HTML - unexpected closing comment sequence ('-->')";d+=a.substr(0,b),a=a.substring(c+3)}return d},sb=function(a){var b,c,d,e,f,g;for(f=/^\s*\r?\n/,g=/\r?\n\s*$/,b=2;b<a.length;b+=1)c=a[b],d=a[b-1],e=a[b-2],c.type===Gb&&d.type===Qb&&e.type===Gb&&g.test(e.value)&&f.test(c.value)&&(d.mustacheType!==Hb&&d.mustacheType!==Ib&&(e.value=e.value.replace(g,"\n")),c.value=c.value.replace(f,""),""===c.value&&a.splice(b--,1));return a},function(a){var b=function(a,b,c){var d;if("string"==typeof b&&t(c)){if(d=a.get(b),void 0===d&&(d=0),t(d))a.set(b,d+c);else if(a.debug)throw new Error("Cannot add to a non-numeric value")}else if(a.debug)throw new Error("Bad arguments")};a.add=function(a,c){b(this,a,void 0===c?1:c)},a.subtract=function(a,c){b(this,a,void 0===c?-1:-c)},a.toggle=function(a){var b;if("string"==typeof a)b=this.get(a),this.set(a,!b);else if(this.debug)throw new Error("Bad arguments")}}(wb),function(a){var c,d;a.animate=function(a,b,d){var e,f,g;if("object"==typeof a){d=b||{},g=[];for(e in a)Ab.call(a,e)&&(g[g.length]=c(this,e,a[e],d));return{stop:function(){for(;g.length;)g.pop().stop()}}}return d=d||{},f=c(this,a,b,d),{stop:function(){f.stop()}}},d={stop:Bb},c=function(a,c,e,f){var g,h,i,j,k;for(k=a.get(c),j=kb.animations.length;j--;)i=kb.animations[j],i.root===a&&i.keypath===c&&i.stop();return u(k,e)?(f.complete&&f.complete(1,f.to),d):(f.easing&&(g="function"==typeof f.easing?f.easing:a.easing&&a.easing[f.easing]?a.easing[f.easing]:b.easing[f.easing],"function"!=typeof g&&(g=null)),h=void 0===f.duration?400:f.duration,i=new db({keypath:c,from:k,to:e,root:a,duration:h,easing:g,step:f.step,complete:f.complete}),kb.push(i),a._animations[a._animations.length]=i,i)}}(wb),wb.cancelFullscreen=function(){b.cancelFullscreen(this.el)},wb.find=function(a){return this.el?this.el.querySelector(a):null},function(){var a,b;wb.findAll=function(c,d){var e;if(!this.el)return[];if(d){if(a.test(c))return this.el.getElementsByTagName(c);if(b.test(c))return this.el.getElementsByClassName(c.substring(1));if(e='Could not generate live nodelist from "'+c+'" selector',this.debug)throw new Error(e);Cb&&Cb.warn&&Cb.warn(e)}return this.el.querySelectorAll(c)},a=/^[a-zA-Z][a-zA-Z0-9\-]*$/,b=/^\.[^\s]+$/g}(),wb.fire=function(a){var b,c,d,e=this._subs[a];if(e)for(b=Array.prototype.slice.call(arguments,1),c=0,d=e.length;d>c;c+=1)e[c].apply(this,b)},function(a){var c,d,e,f,g={};a.get=function(a){var b,d,e,g,h;return a=Bc(a||""),b=this._cache,void 0!==(d=b[a])?d:((g=this._wrapped[a])?e=g.value:a?e=(h=this._evaluators[a])?h.value:c(this,a):(f(this,"",this.data),e=this.data),b[a]=e,e)},c=function(a,c){var d,e,g,h,i,j,k,l;return d=c.split("."),e=d.pop(),g=d.join("."),h=a.get(g),(l=a._wrapped[g])&&(h=l.get()),null!==h&&void 0!==h?((i=a._cacheMap[g])?-1===i.indexOf(c)&&(i[i.length]=c):a._cacheMap[g]=[c],j=h[e],f(a,c,j)?j:(a.magic&&(a._wrapped[c]=b.adaptors.magic.wrap(a,j,c)),a.modifyArrays&&(k=b.adaptors.array,k.filter(a,j,c)&&(a._wrapped[c]=k.wrap(a,j,c))),a._cache[c]=j,j)):void 0},d=function(a,b){var c,d={};if(!b)return a;b+=".";for(c in a)Ab.call(a,c)&&(d[b+c]=a[c]);return d},e=function(a){var b;return g[a]||(b=a?a+".":"",g[a]=function(c,e){var f;return"string"==typeof c?(f={},f[b+c]=e,f):"object"==typeof c?b?d(c,a):c:void 0}),g[a]},f=function(a,c,d){var f,g,h;for(f=a.adaptors.length;f--;){if(g=a.adaptors[f],"string"==typeof g){if(!b.adaptors[g])throw new Error('Missing adaptor "'+g+'"');g=a.adaptors[f]=b.adaptors[g]}if(g.filter(d,c,a))return h=a._wrapped[c]=g.wrap(a,d,c,e(c)),a._cache[c]=d,!0}}}(wb);var uc=function(a){var b,c,d;for(b=a._pendingResolution.length;b--;)c=a._pendingResolution.splice(b,1)[0],d=o(a,c.ref,c.contextStack),void 0!==d?c.resolve(d):a._pendingResolution[a._pendingResolution.length]=c};i=function(a,b){var c,d;if((d=a._wrapped[b])&&d.teardown()!==!1&&(a._wrapped[b]=null),a._cache[b]=void 0,c=a._cacheMap[b])for(;c.length;)i(a,c.pop())};var vc=function(a,b){var c,d,e,f,g,h;for(c=[],h=a.rendered?a.el:a.fragment.docFrag,d=h.querySelectorAll('input[type="checkbox"][name="{{'+b+'}}"]'),f=d.length,g=0;f>g;g+=1)e=d[g],(e.hasAttribute("checked")||e.checked)&&(c[c.length]=e._ractive.value);return c};l=function(a,b,c){var d;for(d=0;d<a._deps.length;d+=1)n(a,b,d,c)},n=function(a,b,c,d){var e,f,g,h;if(e=a._deps[c]){if(f=e[b])for(g=f.length;g--;)f[g].update();if(!d&&(h=a._depsMap[b]))for(g=h.length;g--;)n(a,h[g],c)}},m=function(a,b,c){var d,e,f;for(f=b.length,d=0;d<a._deps.length;d+=1)if(a._deps[d])for(e=f;e--;)n(a,b[e],d,c)},p=function(a){for(var b,c,d;a._defEvals.length;)b=a._defEvals.pop(),b.update().deferred=!1;for(;a._defAttrs.length;)c=a._defAttrs.pop(),c.update().deferred=!1;for(;a._defSelectValues.length;)a._defSelectValues.pop().deferredUpdate();for(;a._defCheckboxes.length;)d=a._defCheckboxes.pop(),a.set(d,vc(a,d));for(;a._defRadios.length;)a._defRadios.pop().update();for(;a._defObservers.length;)a._defObservers.pop().update(!0)},j=function(a){var b,c,d,e,f,g,h,i,j;for(g=a.root,h=a.keypath,i=a.priority,b=g._deps[i]||(g._deps[i]={}),c=b[h]||(b[h]=[]),c[c.length]=a,(j=g._evaluators[h])&&(j.dependants||j.wake(),j.dependants+=1),d=h.split(".");d.length;)d.pop(),e=d.join("."),f=g._depsMap[e]||(g._depsMap[e]=[]),void 0===f[h]&&(f[h]=0,f[f.length]=h),f[h]+=1,h=e},eb=function(a,b){var c,d;c=b.el?v(b.el):a.el,c&&!b.append&&(c.innerHTML=""),a._transitionManager=d=C(a,b.complete),a.fragment=new Q({descriptor:a.template,root:a,owner:a,parentNode:c}),p(a),c&&c.appendChild(a.fragment.docFrag),a._transitionManager=null,d.ready(),a.rendered=!0},o=function(a,b,c){var d,e,f,g,h,i,j,k,l,m,n;if(n='Could not resolve reference - too many "../" prefixes',"."===b)return c.length?c[c.length-1]:"";if("."===b.charAt(0)){if(m=c[c.length-1],f=m?m.split("."):[],"../"===b.substr(0,3)){for(;"../"===b.substr(0,3);){if(!f.length)throw new Error(n);f.pop(),b=b.substring(3)}return f.push(b),f.join(".")}return m?m+b:b.substring(1)}for(d=b.split("."),e=d.pop(),h=d.length?"."+d.join("."):"",c=c.concat();c.length;)if(g=c.pop(),i=g+h,j=a.get(i),(k=a._wrapped[i])&&(j=k.get()),"object"==typeof j&&null!==j&&Ab.call(j,e)){l=g+"."+b;break}return l||void 0===a.get(b)||(l=b),l},h=function(a){if(a.keypath)k(a);else{var b=a.root._pendingResolution.indexOf(a);-1!==b&&a.root._pendingResolution.splice(b,1)}},k=function(a){var b,c,d,e,f,g,h,i;for(f=a.root,g=a.keypath,h=a.priority,b=f._deps[h][g],b.splice(b.indexOf(a),1),c=g.split("."),(i=f._evaluators[g])&&(i.dependants-=1,i.dependants||i.sleep());c.length;)c.pop(),d=c.join("."),e=f._depsMap[d],e[g]-=1,e[g]||(e.splice(e.indexOf(g),1),e[g]=void 0),g=d},wb.link=function(a){var b=this;return function(c){b.set(a,c)}},function(a){var b,c;a.observe=function(a,c,d){var e,f=[];if("object"==typeof a){d=c||{};for(e in a)Ab.call(a,e)&&(c=a[e],f[f.length]=b(this,e,c,d));return{cancel:function(){for(;f.length;)f.pop().cancel()}}}return b(this,a,c,d||{})
},b=function(a,b,d,e){var f;return f=new c(a,b,d,e),e.init!==!1&&f.update(),f.ready=!0,j(f),{cancel:function(){k(f)}}},c=function(a,b,c,d){this.root=a,this.keypath=b,this.callback=c,this.defer=d.defer,this.priority=0,this.context=d.context||a},c.prototype={update:function(a){var b;if(this.defer&&!a&&this.ready)return this.root._defObservers.push(this),void 0;if(!this.updating){if(this.updating=!0,b=this.root.get(this.keypath,!0),!u(b,this.value)||!this.ready){try{this.callback.call(this.context,b,this.value)}catch(c){if(this.root.debug)throw c}this.value=b}this.updating=!1}}}}(wb),wb.off=function(a,b){var c,d;b||(a?this._subs[a]=[]:this._subs={}),c=this._subs[a],c&&(d=c.indexOf(b),-1!==d&&c.splice(d,1))},wb.on=function(a,b){var c,d,e=this;if("object"==typeof a){c=[];for(d in a)Ab.call(a,d)&&(c[c.length]=this.on(d,a[d]));return{cancel:function(){for(;c.length;)c.pop().cancel()}}}return this._subs[a]?this._subs[a].push(b):this._subs[a]=[b],{cancel:function(){e.off(a,b)}}},wb.renderHTML=function(){return this.fragment.toString()},wb.requestFullscreen=function(){b.requestFullscreen(this.el)},wb.reset=function(a,b){var c,d;if("function"==typeof a&&(b=a,a={}),void 0!==a&&"object"!=typeof a)throw new Error("The reset method takes either no arguments, or an object containing new data");d=this._transitionManager,this._transitionManager=c=C(this,b),this.data=a||{},this._pendingResolution.length&&uc(this),i(this,""),l(this,""),this.fire("reset",a),this._transitionManager=d,c.ready()},function(a){var b,c,d;a.set=function(a,d,e){var f,g,h,i,j,k,l;if(g=[],s(a)&&(f=a,e=d),f)for(a in f)Ab.call(f,a)&&(d=f[a],a=Bc(a),b(this,a,d,g));else a=Bc(a),b(this,a,d,g);if(g.length){if(i=this._transitionManager,this._transitionManager=j=C(this,e),h=c(g),h.length&&m(this,h,!0),m(this,g),this._pendingResolution.length&&uc(this),p(this),this._transitionManager=i,j.ready(),!this.firingChangeEvent){for(this.firingChangeEvent=!0,l={},k=g.length;k--;)l[g[k]]=this.get(g[k]);this.fire("change",l),this.firingChangeEvent=!1}return this}},b=function(a,b,c,e){var f,g,h,j,k,l,m,n,o;if(!(o=a._wrapped[b])||!o.reset||d(a,b,c,o,e)===!1){if(f=a._cache[b],h=a.get(b),g=b.split("."),l=[],h!==c){for((o=a._wrapped[""])?(o.set&&o.set(g.join("."),c),k=o.get()):k=a.data;g.length>1;)j=l[l.length]=g.shift(),m=l.join("."),(o=a._wrapped[m])?(o.set&&o.set(g.join("."),c),k=o.get()):(k[j]||(n||(n=m),k[j]=/^\s*[0-9]+\s*$/.test(g[0])?[]:{}),k=k[j]);j=g[0],k[j]=c}else if(c===f&&"object"!=typeof c)return;i(a,n||b),e[e.length]=b}},c=function(a){var b,c,d,e,f=[""];for(b=a.length;b--;)for(c=a[b],d=c.split(".");d.length>1;)d.pop(),e=d.join("."),f[e]||(f[f.length]=e,f[e]=!0);return f},d=function(a,b,c,d,e){var f,g,h,j;if(f=d.get(),!u(f,c)&&d.reset(c)===!1)return!1;if(c=d.get(),g=a._cache[b],!u(g,c)){if(a._cache[b]=c,h=a._cacheMap[b])for(j=h.length;j--;)i(a,h[j]);e[e.length]=b}}}(wb),wb.teardown=function(a){var b,c,d;for(this.fire("teardown"),d=this._transitionManager,this._transitionManager=c=C(this,a),this.fragment.teardown(!0);this._animations[0];)this._animations[0].stop();for(b in this._cache)i(this,b);this._transitionManager=d,c.ready()},wb.toggleFullscreen=function(){b.isFullscreen(this.el)?this.cancelFullscreen():this.requestFullscreen()},wb.update=function(a,b){var c,d;return"function"==typeof a&&(b=a,a=""),uc(this),d=this._transitionManager,this._transitionManager=c=C(this,b),i(this,a||""),l(this,a||""),p(this),this._transitionManager=d,c.ready(),"string"==typeof a?this.fire("update",a):this.fire("update"),this},function(a){var b;a.updateModel=function(a,c){var d,e,f;if("string"!=typeof a&&(a="",c=!0),b(this,a,d={},e=[],c),f=e.length)for(;f--;)a=e[f],d[a]=vc(this,a);this.set(d)},b=function(a,c,d,e,f){var g,h,i,j,k,l;if(g=a._twowayBindings[c])for(i=g.length;i--;)j=g[i],(!j.radioName||j.node.checked)&&(j.checkboxName?j.changed()&&!e[c]&&(e[c]=!0,e[e.length]=c):(k=j.attr.value,l=j.value(),Ac(k,l)||u(k,l)||(d[c]=l)));if(f&&(h=a._depsMap[c]))for(i=h.length;i--;)b(a,h[i],d,e,f)}}(wb),function(){var a,b,c,d,e,f,g;xb.array={filter:function(a,b,c){return"("!==c.charAt(0)&&r(b)&&(!b._ractive||!b._ractive.setting)},wrap:function(a,c,d){return new b(a,c,d)}},b=function(a,b,c){this.root=a,this.value=b,this.keypath=c,lb(b,c,a)},b.prototype={get:function(){return this.value},teardown:function(){return this.value._ractive.setting?!1:(mb(this.value,this.keypath,this.root),void 0)}},lb=function(a,b,d){var e,f,g;a._ractive?(e=a._ractive.roots,f=a._ractive.keypathsByGuid,f[d._guid]||(e[e.length]=d,f[d._guid]=[]),g=f[d._guid],-1===g.indexOf(b)&&(g[g.length]=b)):(E(a,"_ractive",{value:{roots:[d],keypathsByGuid:{}},configurable:!0}),a._ractive.keypathsByGuid[d._guid]=[b],c(a))},mb=function(a,b,c){var e,f,g,h;if(!a._ractive)throw new Error("Attempted to remove keypath from non-wrapped array. This error is unexpected - please send a bug report to @rich_harris");if(e=a._ractive.roots,f=a._ractive.keypathsByGuid,!f[c._guid])throw new Error("Ractive instance was not listed as a dependent of this array. This error is unexpected - please send a bug report to @rich_harris");if(g=f[c._guid],h=g.indexOf(b),-1===h)throw new Error("Attempted to unlink non-linked keypath from array. This error is unexpected - please send a bug report to @rich_harris");g.splice(h,1),g.length||(e.splice(e.indexOf(c),1),f[c._guid]=null),e.length||d(a)},a=function(a,b,c){var d,e,f,g,h,j;j=a._ractive.keypathsByGuid,d=function(a){for(var b=a.length;b--;)e(a[b])},e=function(a){var b,c=a._transitionManager;a._transitionManager=b=C(a,Bb),f(a,j[a._guid]),a._transitionManager=c,b.ready()},f=function(a,b){for(var c=b.length;c--;)g(a,b[c])},g=function(d,e){var f,g,j,k,n,o,q,r,s,t,u,v;if("sort"===b||"reverse"===b)return d.set(e,a),void 0;for(i(d,e),n=[],o=[],q=0;q<d._deps.length;q+=1)if(f=d._deps[q],f&&(g=f[e])){for(h(d,e,g,n,o),p(d);n.length;)n.pop().smartUpdate(b,c);for(;o.length;)o.pop().update()}if("splice"===b&&c.length>2&&c[1])for(r=Math.min(c[1],c.length-2),s=c[0],t=s+r,c[1]===c.length-2&&(v=!0),q=s;t>q;q+=1)u=e+"."+q,l(d,u);for(p(d),k=[],j=e.split(".");j.length;)j.pop(),k[k.length]=j.join(".");m(d,k,!0),v||l(d,e+".length",!0)},h=function(a,b,c,d,e){var f,g;for(f=c.length;f--;)g=c[f],g.type===$b?g.update():g.keypath===b&&g.type===Jb&&g.parentNode?d[d.length]=g:e[e.length]=g},d(a._ractive.roots)},e=[],g=["pop","push","reverse","shift","sort","splice","unshift"],g.forEach(function(b){var c=function(){var c=Array.prototype[b].apply(this,arguments);return this._ractive.setting=!0,a(this,b,arguments),this._ractive.setting=!1,c};E(e,b,{value:c})}),f={},f.__proto__?(c=function(a){a.__proto__=e},d=function(a){delete a._ractive,a.__proto__=Array.prototype}):(c=function(a){var b,c;for(b=g.length;b--;)c=g[b],E(a,c,{value:e[c],configurable:!0})},d=function(a){var b;for(b=g.length;b--;)delete a[g[b]];delete a._ractive})}(),function(){var a;xb.magic={wrap:function(b,c,d){return new a(b,c,d)}},a=function(a,b,c){var d,e,f,g,h,i,j,k,l,m=this;if(this.ractive=a,this.keypath=c,d=c.split("."),this.prop=d.pop(),f=d.join("."),this.obj=a.get(f),g=this.originalDescriptor=Object.getOwnPropertyDescriptor(this.obj,this.prop),g&&g.set&&(h=g.set._ractiveWrappers))return-1===h.indexOf(this)&&(h[h.length]=this),void 0;if(g&&!g.configurable)throw new Error('Cannot use magic mode with property "'+e+'" - object is not configurable');g&&(this.value=g.value,i=g.get,j=g.set),k=i||function(){return m.value},l=function(a){var b,c,d;for(j&&j(a),b=l._ractiveWrappers,d=b.length;d--;)c=b[d],c.resetting||c.ractive.set(c.keypath,a)},l._ractiveWrappers=[this],Object.defineProperty(this.obj,this.prop,{get:k,set:l,enumerable:!0,configurable:!0})},a.prototype={get:function(){return this.value},reset:function(a){this.resetting=!0,this.value=a,this.obj[this.prop]=a,this.resetting=!1},teardown:function(){var a,b,c,d;a=Object.getOwnPropertyDescriptor(this.obj,this.prop),b=a.set,d=b._ractiveWrappers,d.splice(d.indexOf(this),1),d.length||(c=this.obj[this.prop],Object.defineProperty(this.obj,this.prop,this.originalDescriptor),this.obj[this.prop]=c)}}}(),c={linear:function(a){return a},easeIn:function(a){return Math.pow(a,3)},easeOut:function(a){return Math.pow(a-1,3)+1},easeInOut:function(a){return(a/=.5)<1?.5*Math.pow(a,3):.5*(Math.pow(a-2,3)+2)}},yb.hover=function(a,b){var c,d;return c=function(c){a.contains(c.relatedTarget)||b({node:a,original:c,hover:!0})},d=function(c){a.contains(c.relatedTarget)||b({node:a,original:c,hover:!1})},a.addEventListener("mouseover",c,!1),a.addEventListener("mouseout",d,!1),{teardown:function(){a.removeEventListener("mouseover",c,!1),a.removeEventListener("mouseout",d,!1)}}},function(){var a=function(a){return function(b,c){var d;return b.addEventListener("keydown",d=function(d){var e=d.which||d.keyCode;e===a&&(d.preventDefault(),c({node:b,original:d}))},!1),{teardown:function(){b.removeEventListener("keydown",d,!1)}}}};yb.enter=a(13),yb.tab=a(9),yb.escape=a(27),yb.space=a(32),yb.leftarrow=a(37),yb.rightarrow=a(39),yb.downarrow=a(40),yb.uparrow=a(38)}(),yb.tap=function(a,b){var c,d,e,f,g;return f=5,g=400,c=function(c){var d,e,h,i,j,k,l;(void 0===c.which||1===c.which)&&(e=c.clientX,h=c.clientY,d=this,i=c.pointerId,j=function(a){a.pointerId==i&&(b({node:d,original:a}),l())},k=function(a){a.pointerId==i&&(Math.abs(a.clientX-e)>=f||Math.abs(a.clientY-h)>=f)&&l()},l=function(){a.removeEventListener("MSPointerUp",j,!1),vb.removeEventListener("MSPointerMove",k,!1),vb.removeEventListener("MSPointerCancel",l,!1),a.removeEventListener("pointerup",j,!1),vb.removeEventListener("pointermove",k,!1),vb.removeEventListener("pointercancel",l,!1),a.removeEventListener("click",j,!1),vb.removeEventListener("mousemove",k,!1)},window.navigator.pointerEnabled?(a.addEventListener("pointerup",j,!1),vb.addEventListener("pointermove",k,!1),vb.addEventListener("pointercancel",l,!1)):window.navigator.msPointerEnabled?(a.addEventListener("MSPointerUp",j,!1),vb.addEventListener("MSPointerMove",k,!1),vb.addEventListener("MSPointerCancel",l,!1)):(a.addEventListener("click",j,!1),vb.addEventListener("mousemove",k,!1)),setTimeout(l,g))},window.navigator.pointerEnabled?a.addEventListener("pointerdown",c,!1):window.navigator.msPointerEnabled?a.addEventListener("MSPointerDown",c,!1):a.addEventListener("mousedown",c,!1),d=function(c){var d,e,h,i,j,k,l,m;1===c.touches.length&&(i=c.touches[0],e=i.clientX,h=i.clientY,d=this,j=i.identifier,l=function(a){var c;c=a.changedTouches[0],c.identifier!==j&&m(),a.preventDefault(),b({node:d,original:a}),m()},k=function(a){var b;(1!==a.touches.length||a.touches[0].identifier!==j)&&m(),b=a.touches[0],(Math.abs(b.clientX-e)>=f||Math.abs(b.clientY-h)>=f)&&m()},m=function(){a.removeEventListener("touchend",l,!1),window.removeEventListener("touchmove",k,!1),window.removeEventListener("touchcancel",m,!1)},a.addEventListener("touchend",l,!1),window.addEventListener("touchmove",k,!1),window.addEventListener("touchcancel",m,!1),setTimeout(m,g))},a.addEventListener("touchstart",d,!1),("BUTTON"===a.tagName||"button"===a.type)&&(e=function(){var c,d;d=function(c){32===c.which&&b({node:a,original:c})},c=function(){a.removeEventListener("keydown",d,!1),a.removeEventListener("blur",c,!1)},a.addEventListener("keydown",d,!1),a.addEventListener("blur",c,!1)},a.addEventListener("focus",e,!1)),{teardown:function(){a.removeEventListener("pointerdown",c,!1),a.removeEventListener("MSPointerDown",c,!1),a.removeEventListener("mousedown",c,!1),a.removeEventListener("touchstart",d,!1),a.removeEventListener("focus",e,!1)}}},function(){var a,c,e,f,g,h,i,j,k,l,m,n,o;d=function(a){var c,d=this;return c=function(a){l(this,c,a||{})},c.prototype=G(d.prototype),d!==b&&f(c,d),h(c,a),i(c),j(c,a),k(c),c.extend=d.extend,c},m=["data","partials","transitions","eventDefinitions","components"],n=["el","template","complete","modifyArrays","twoway","lazy","append","preserveWhitespace","sanitize","noIntro","transitionsEnabled"],o=m.concat(n),f=function(a,b){m.forEach(function(d){b[d]&&(a[d]=c(b[d]))}),n.forEach(function(c){void 0!==b[c]&&(a[c]=b[c])})},g=function(a,b){return/_super/.test(a)?function(){var c,d=this._super;return this._super=b,c=a.apply(this,arguments),this._super=d,c}:a},h=function(a,b){var c,d;m.forEach(function(c){var d=b[c];d&&(a[c]?e(a[c],d):a[c]=d)}),n.forEach(function(c){void 0!==b[c]&&(a[c]=b[c])});for(c in b)Ab.call(b,c)&&!Ab.call(a.prototype,c)&&-1===o.indexOf(c)&&(d=b[c],a.prototype[c]="function"==typeof d&&"function"==typeof a.prototype[c]?g(d,a.prototype[c]):d)},i=function(a){var c;if("string"==typeof a.template){if(!b.parse)throw new Error(Fb);if("#"===a.template.charAt(0)&&vb){if(c=vb.getElementById(a.template.substring(1)),!c||"SCRIPT"!==c.tagName)throw new Error("Could not find template element ("+a.template+")");a.template=b.parse(c.innerHTML,a)}else a.template=b.parse(a.template,a)}},j=function(a,b){s(a.template)&&(a.partials||(a.partials={}),e(a.partials,a.template.partials),b.partials&&e(a.partials,b.partials),a.template=a.template.main)},k=function(a){var c,d;if(a.partials)for(c in a.partials)if(Ab.call(a.partials,c)){if("string"==typeof a.partials[c]){if(!b.parse)throw new Error(Fb);d=b.parse(a.partials[c],a)}else d=a.partials[c];a.partials[c]=d}},l=function(d,e,f){!f.template&&e.template&&(f.template=e.template),m.forEach(function(b){f[b]?a(f[b],e[b]):e[b]&&(f[b]=c(e[b]))}),n.forEach(function(a){void 0===f[a]&&void 0!==e[a]&&(f[a]=e[a])}),d.beforeInit&&d.beforeInit.call(d,f),b.call(d,f),d.init&&d.init.call(d,f)},a=function(a,b){var c;for(c in b)Ab.call(b,c)&&!Ab.call(a,c)&&(a[c]=b[c])},c=function(a){var b,c={};for(b in a)Ab.call(a,b)&&(c[b]=a[b]);return c},e=function(a,b){var c;for(c in b)Ab.call(b,c)&&(a[c]=b[c])}}(),f=function(a,c){return t(a)&&t(c)?b.interpolators.number(+a,+c):r(a)&&r(c)?b.interpolators.array(a,c):s(a)&&s(c)?b.interpolators.object(a,c):function(){return c}},g={number:function(a,b){var c=b-a;return c?function(b){return a+b*c}:function(){return a}},array:function(a,c){var d,e,f,g;for(d=[],e=[],g=f=Math.min(a.length,c.length);g--;)e[g]=b.interpolate(a[g],c[g]);for(g=f;g<a.length;g+=1)d[g]=a[g];for(g=f;g<c.length;g+=1)d[g]=c[g];return function(a){for(var b=f;b--;)d[b]=e[b](a);return d}},object:function(a,c){var d,e,f,g,h=[];f={},e={};for(g in a)Ab.call(a,g)&&(Ab.call(c,g)?(h[h.length]=g,e[g]=b.interpolate(a[g],c[g])):f[g]=a[g]);for(g in c)Ab.call(c,g)&&!Ab.call(a,g)&&(f[g]=c[g]);return d=h.length,function(a){for(var b,c=d;c--;)b=h[c],f[b]=e[b](a);return f}}};var wc,xc,yc=H();wc=function(){return{}},xc=function(){return[]},F(yc,{preserveWhitespace:{enumerable:!0,value:!1},append:{enumerable:!0,value:!1},twoway:{enumerable:!0,value:!0},modifyArrays:{enumerable:!0,value:!0},data:{enumerable:!0,value:wc},lazy:{enumerable:!0,value:!1},debug:{enumerable:!0,value:!1},transitions:{enumerable:!0,value:wc},eventDefinitions:{enumerable:!0,value:wc},noIntro:{enumerable:!0,value:!1},transitionsEnabled:{enumerable:!0,value:!0},magic:{enumerable:!0,value:!1},adaptors:{enumerable:!0,value:xc}}),b=function(a){var c,d,e,f;for(c in yc)void 0===a[c]&&(a[c]="function"==typeof yc[c]?yc[c]():yc[c]);if(F(this,{_guid:{value:"xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g,function(a){var b,c;return b=0|16*Math.random(),c="x"==a?b:8|3&b,c.toString(16)})},_subs:{value:H()},_cache:{value:{}},_cacheMap:{value:H()},_deps:{value:[]},_depsMap:{value:H()},_pendingResolution:{value:[]},_defAttrs:{value:[]},_defEvals:{value:[]},_defSelectValues:{value:[]},_defCheckboxes:{value:[]},_defRadios:{value:[]},_defObservers:{value:[]},_evaluators:{value:H()},_twowayBindings:{value:{}},_transitionManager:{value:null,writable:!0},_animations:{value:[]},nodes:{value:{}},_wrapped:{value:H()}}),this.modifyArrays=a.modifyArrays,this.magic=a.magic,this.twoway=a.twoway,this.lazy=a.lazy,this.debug=a.debug,this.magic&&tb)throw new Error("Getters and setters (magic mode) are not supported in this browser");if(a.el&&(this.el=v(a.el),!this.el&&this.debug))throw new Error("Could not find container element");if(this.data=a.data,this.components=a.components||{},this.transitions=a.transitions,this.eventDefinitions=a.eventDefinitions,this.adaptors=a.adaptors,d=a.template,"string"==typeof d){if(!b.parse)throw new Error(Fb);if("#"===d.charAt(0)&&vb){if(e=vb.getElementById(d.substring(1)),!e)throw new Error("Could not find template element ("+d+")");f=b.parse(e.innerHTML,a)}else f=b.parse(d,a)}else f=d;if(s(f)?(this.partials=f.partials,f=f.main):this.partials={},f&&1===f.length&&"string"==typeof f[0]&&(f=f[0]),this.template=f,a.partials)for(c in a.partials)Ab.call(a.partials,c)&&(this.partials[c]=a.partials[c]);this.parseOptions={preserveWhitespace:a.preserveWhitespace,sanitize:a.sanitize},this.transitionsEnabled=a.noIntro?!1:a.transitionsEnabled,eb(this,{el:this.el,append:a.append,complete:a.complete}),this.transitionsEnabled=a.transitionsEnabled},function(){var a,b,d,e;vb&&(a=function(a,b){var c,d={};for(c=b.length;c--;)d[b[c]]=a[b[c]];return d},b=function(a,b,c,d){for(var e,f=b.length;f--;)e=b[f],a.style[e]=c&&c[e]?"function"==typeof c[e]?c[e](d):c[e]:0},d=function(a,b){var c;if(!b)return a;for(c in b)Ab.call(b,c)&&(a[c]=b[c]);return a},jc&&(e=function(e,f,g,h){return"string"==typeof e&&(e=[e]),function(i,j,k,l){var m,n,o,p,q,r,s,t,u,v,w;k=zc(k),r=k.duration||f.duration,c=mc(k.easing||f.easing),s=k.delay||0,t=l?g:h,u=l?h:g,n=window.getComputedStyle(i),q=i.getAttribute("style"),l?(v=i.style.position,w=i.style.visibility,i.style.position="absolute",i.style.visibility="hidden",setTimeout(function(){o=a(n,e),t=g,u=d(o,h),i.style.position=v,i.style.visibility=w,b(i,e,t,k),setTimeout(p,0)},s)):setTimeout(function(){o=a(n,e),t=d(o,h),u=g,b(i,e,t,k),setTimeout(p,0)},s),p=function(){i.style[kc+"Duration"]=r/1e3+"s",i.style[kc+"Properties"]=e.map(mc).join(","),i.style[kc+"TimingFunction"]=c,m=function(){i.removeEventListener(lc,m,!1),l&&i.setAttribute("style",q||""),j()},i.addEventListener(lc,m,!1),b(i,e,u,k)}}},zb.slide=e(["height","borderTopWidth","borderBottomWidth","paddingTop","paddingBottom","overflowY"],{duration:400,easing:"easeInOut"},{overflowY:"hidden"},{overflowY:"hidden"}),zb.fade=e("opacity",{duration:300,easing:"linear"}),zb.fly=e(["opacity","left","position"],{duration:400,easing:"easeOut"},{position:"relative",left:"-500px"},{position:"relative",left:0})))}();var zc=function(a){return"fast"===a?{duration:200}:"slow"===a?{duration:600}:t(a)?{duration:+a}:a||{}};!function(a){var b,c,d;vb&&(c=function(a,b,e){var f,g;return 1===a.nodeType&&(a.style.display=a._display),3===a.nodeType?(d(a,b,e),void 0):(f=Array.prototype.slice.call(a.childNodes),g=function(){return f.length?(c(f.shift(),g,e),void 0):(1===a.nodeType&&a.setAttribute("style",a._style||""),b(),void 0)},g(),void 0)},d=function(a,b,c){var d,e,f,g;return d=a._hiddenData,(e=d.length)?(g=0,f=setInterval(function(){var c,h,i,j,k;c=d.substr(0,g),h=d.substring(g),i=/^\w+/.exec(h),j=i?i[0].length:0,k=new Array(j+1).join(" "),a.data=c+k,g===e&&(clearInterval(f),delete a._hiddenData,b()),g+=1},c),void 0):(b(),void 0)},b=function(a,b,d){var e,f,g,h;d=zc(d),e=d.interval||(d.speed?1e3/d.speed:d.duration?a.textContent.length/d.duration:4),f=a.getAttribute("style"),g=window.getComputedStyle(a),a.style.visibility="hidden",setTimeout(function(){var i,j,k;j=g.width,i=g.height,k=g.visibility,h(a),setTimeout(function(){a.style.width=j,a.style.height=i,a.style.visibility="visible",c(a,function(){a.setAttribute("style",f||""),b()},e)},d.delay||0)}),h=function(a){var b,c;if(1===a.nodeType&&(a._style=a.getAttribute("style"),a._display=window.getComputedStyle(a).display,a.style.display="none"),3===a.nodeType)return a._hiddenData=""+a.data,a.data="",void 0;for(b=Array.prototype.slice.call(a.childNodes),c=b.length;c--;)h(b[c])}},a.typewriter=b)}(zb),function(a){var b,c,d;if(vb){if(a.fullscreenEnabled=vb.fullscreenEnabled||vb.mozFullScreenEnabled||vb.webkitFullscreenEnabled,!a.fullscreenEnabled)return a.requestFullscreen=a.cancelFullscreen=Bb,a.isFullscreen=function(){return!1},void 0;gc.requestFullscreen?b="requestFullscreen":gc.mozRequestFullScreen?b="mozRequestFullScreen":gc.webkitRequestFullscreen&&(b="webkitRequestFullscreen"),a.requestFullscreen=function(a){a[b]&&a[b]()},vb.cancelFullscreen?c="cancelFullscreen":vb.mozCancelFullScreen?c="mozCancelFullScreen":vb.webkitCancelFullScreen&&(c="webkitCancelFullScreen"),a.cancelFullscreen=function(){vb[c]()},void 0!==vb.fullscreenElement?d="fullscreenElement":void 0!==vb.mozFullScreenElement?d="mozFullScreenElement":void 0!==vb.webkitFullscreenElement&&(d="webkitFullscreenElement"),a.isFullscreen=function(a){return a===vb[d]}}}(b),db=function(a){var c;this.startTime=Date.now();for(c in a)Ab.call(a,c)&&(this[c]=a[c]);this.interpolator=b.interpolate(this.from,this.to),this.running=!0},db.prototype={tick:function(){var a,b,c,d,e;return this.running?(d=Date.now(),a=d-this.startTime,a>=this.duration?(this.root.set(this.keypath,this.to),this.step&&this.step(1,this.to),this.complete&&this.complete(1,this.to),e=this.root._animations.indexOf(this),-1===e&&Cb&&Cb.warn&&Cb.warn("Animation was not found"),this.root._animations.splice(e,1),this.running=!1,!1):(b=this.easing?this.easing(a/this.duration):a/this.duration,c=this.interpolator(b),this.root.set(this.keypath,c),this.step&&this.step(b,c),!0)):!1},stop:function(){var a;this.running=!1,a=this.root._animations.indexOf(this),-1===a&&Cb&&Cb.warn&&Cb.warn("Animation was not found"),this.root._animations.splice(a,1)}},kb={animations:[],tick:function(){var a,b;for(a=0;a<this.animations.length;a+=1)b=this.animations[a],b.tick()||this.animations.splice(a--,1);this.animations.length?D(this.boundTick):this.running=!1},boundTick:function(){kb.tick()},push:function(a){this.animations[this.animations.length]=a,this.running||(this.running=!0,this.tick())}},function(a,b,c){var d,e;if(c.requestAnimationFrame)return D=c.requestAnimationFrame,void 0;for(d=0;d<a.length&&!D;++d)D=c[a[d]+"RequestAnimationFrame"];D||(e=c.setTimeout,D=function(a){var c,d,f;return c=Date.now(),d=Math.max(0,16-(c-b)),f=e(function(){a(c+d)},d),b=c+d,f})}(["ms","moz","webkit","o"],0,a);var Ac=function(a,b){var c;if(!r(a)||!r(b))return!1;if(a.length!==b.length)return!1;for(c=a.length;c--;)if(a[c]!==b[c])return!1;return!0};!function(){var a,b,c,d;a={"accept-charset":"acceptCharset",accesskey:"accessKey",bgcolor:"bgColor","class":"className",codebase:"codeBase",colspan:"colSpan",contenteditable:"contentEditable",datetime:"dateTime",dirname:"dirName","for":"htmlFor","http-equiv":"httpEquiv",ismap:"isMap",maxlength:"maxLength",novalidate:"noValidate",pubdate:"pubDate",readonly:"readOnly",rowspan:"rowSpan",tabindex:"tabIndex",usemap:"useMap"},S=function(a){return this.element=a.element,b(this,a.name),null===a.value||"string"==typeof a.value?(c(this,a),void 0):(this.root=a.root,this.parentNode=a.parentNode,this.parentFragment=this.element.parentFragment,this.fragment=new Z({descriptor:a.value,root:this.root,owner:this,contextStack:a.contextStack}),this.parentNode&&("value"===this.name&&(a.element.ractify(),this.isValueAttribute=!0,"INPUT"===this.parentNode.tagName&&"file"===this.parentNode.type&&(this.isFileInputValue=!0)),d(this,a),this.selfUpdating=B(this.fragment),this.ready=!0),void 0)},S.prototype={bind:P,update:O,updateBindings:function(){this.keypath=this.interpolator.keypath||this.interpolator.r,"name"===this.propertyName&&(this.parentNode.name="{{"+this.keypath+"}}")},teardown:function(){var a;if(this.boundEvents)for(a=this.boundEvents.length;a--;)this.parentNode.removeEventListener(this.boundEvents[a],this.updateModel,!1);this.fragment&&this.fragment.teardown()},bubble:function(){this.selfUpdating?this.update():!this.deferred&&this.ready&&(this.root._defAttrs[this.root._defAttrs.length]=this,this.deferred=!0)},toString:function(){var a;return null===this.value?this.name:this.fragment?(a=this.fragment.toString(),this.name+"="+JSON.stringify(a)):this.name+"="+JSON.stringify(this.value)}},b=function(a,b){var c,d;if(c=b.indexOf(":"),-1===c||(d=b.substr(0,c),"xmlns"===d))a.name=b;else if(b=b.substring(c+1),a.name=b,a.namespace=hc[d],!a.namespace)throw'Unknown namespace ("'+d+'")'},c=function(a,b){var c=null===b.value?"":b.value;b.parentNode&&(a.namespace?b.parentNode.setAttributeNS(a.namespace,b.name,c):b.parentNode.setAttribute(b.name,c),"id"===a.name&&(b.root.nodes[b.value]=b.parentNode),"value"===a.name&&(a.element.ractify().value=b.value)),a.value=b.value},d=function(b,c){var d;!b.parentNode||b.namespace||c.parentNode.namespaceURI&&c.parentNode.namespaceURI!==hc.html||(d=a[b.name]||b.name,void 0!==c.parentNode[d]&&(b.propertyName=d),("boolean"==typeof c.parentNode[d]||"value"===d)&&(b.useProperty=!0))}}(),function(){var a;U=function(b,c){var d,e,f,g,h,i,j,k,l,m,n,p,q,r,s,t,u,v,w,x,y=this,z=this.parentFragment=b.parentFragment;if(d=z.root,this.type=Sb,this.name=b.descriptor.r,e=A(z.root,b.descriptor.e),!e)throw new Error('Component "'+b.descriptor.e+'" not found');if(f=e.twoway!==!1,j={},k=[],this.complexParameters=[],u=function(b,c){var e;if("string"!=typeof c){if(null===c)return j[b]=!0,void 0;if(1===c.length&&c[0].t===Hb&&c[0].r)return z.indexRefs&&void 0!==z.indexRefs[c[0].r]?(j[b]=z.indexRefs[c[0].r],void 0):(i=o(d,c[0].r,z.contextStack)||c[0].r,j[b]=d.get(i),k[k.length]=[b,i],void 0);e=new a(d,y,b,c,z.contextStack),y.complexParameters[y.complexParameters.length]=e,j[b]=e.value}else try{j[b]=JSON.parse(c)}catch(f){j[b]=c}},b.descriptor.a)for(s in b.descriptor.a)b.descriptor.a.hasOwnProperty(s)&&u(s,b.descriptor.a[s]);for(g={},b.descriptor.f&&(g.content=b.descriptor.f),h=this.instance=new e({el:z.parentNode.cloneNode(!1),data:j,partials:g});h.el.firstChild;)c.appendChild(h.el.firstChild);if(h.el=z.parentNode,x=h.fragment.items)for(l=x.length;l--;)x[l].parentNode&&(x[l].parentNode=z.parentNode);for(y.observers=[],t={init:!1},n=function(a){var b=d.observe(a[1],function(b){q||(r=!0,h.set(a[0],b),r=!1)},t);y.observers[y.observers.length]=b},f&&(p=function(a){var b=h.observe(a[0],function(b){r||(q=!0,d.set(a[1],b),q=!1)},t);y.observers[y.observers.length]=b,d.set(a[1],h.get(a[0]))}),l=k.length;l--;)m=k[l],n(m),f&&p(m);if(w=function(a,b){h.on(a,function(){var a=Array.prototype.slice.call(arguments);a.unshift(b),d.fire.apply(d,a)})},b.descriptor.v)for(v in b.descriptor.v)b.descriptor.v.hasOwnProperty(v)&&w(v,b.descriptor.v[v])},U.prototype={firstNode:function(){return this.instance.fragment.firstNode()},findNextNode:function(){return this.parentFragment.findNextNode(this)},teardown:function(){for(;this.complexParameters.length;)this.complexParameters.pop().teardown();for(;this.observers.length;)this.observers.pop().cancel();this.instance.teardown()},toString:function(){return this.instance.fragment.toString()}},a=function(a,b,c,d,e){this.parentFragment=b.parentFragment,this.component=b,this.key=c,this.fragment=new Z({descriptor:d,root:a,owner:this,contextStack:e}),this.selfUpdating=B(this.fragment),this.value=this.fragment.getValue()},a.prototype={bubble:function(){this.selfUpdating?this.update():!this.deferred&&this.ready&&(this.root._defAttrs[this.root._defAttrs.length]=this,this.deferred=!0)},update:function(){var a=this.fragment.getValue();this.component.set(this.key,a),this.value=a}}}(),R=function(a,b){var c,d,e,f,g;this.type=Mb,c=this.parentFragment=a.parentFragment,d=this.descriptor=a.descriptor,this.root=g=c.root,this.parentNode=c.parentNode,this.index=a.index,this.eventListeners=[],this.customEventListeners=[],this.parentNode&&(e=N(d,this.parentNode),this.node=vb.createElementNS(e,d.e)),f=M(this,d.a),d.f&&K(this,this.node,d,b),b&&d.v&&I(this,d.v),b&&(g.twoway&&L(this,f),f.name&&!f.name.twoway&&f.name.update(),b.appendChild(this.node),d.t1&&y(d.t1,g,this,c.contextStack,!0))},R.prototype={teardown:function(a){var b,c,d;for(this.fragment&&this.fragment.teardown(!1);this.attributes.length;)this.attributes.pop().teardown();if(this.node._ractive){for(b in this.node._ractive.events)this.node._ractive.events[b].teardown();(c=this.node._ractive.binding)&&(c.teardown(),d=this.root._twowayBindings[c.attr.keypath],d.splice(d.indexOf(c),1))}this.descriptor.t2&&y(this.descriptor.t2,this.root,this,this.parentFragment.contextStack,!1),a&&this.root._transitionManager.detachWhenReady(this.node)},firstNode:function(){return this.node},findNextNode:function(){return null},bubble:Bb,toString:function(){var a,b,c;for(a="<"+this.descriptor.e,c=this.attributes.length,b=0;c>b;b+=1)a+=" "+this.attributes[b].toString();return a+=">",this.html?a+=this.html:this.fragment&&(a+=this.fragment.toString()),a+="</"+this.descriptor.e+">"},ractify:function(){var a=this.parentFragment.contextStack;return this.node._ractive||E(this.node,"_ractive",{value:{keypath:a.length?a[a.length-1]:"",index:this.parentFragment.indexRefs,events:H(),root:this.root}}),this.node._ractive}},Q=function(a){return a.parentNode&&(this.docFrag=vb.createDocumentFragment()),"string"==typeof a.descriptor?(this.html=a.descriptor,this.docFrag&&(this.nodes=w(a.descriptor,a.parentNode.tagName,this.docFrag)),void 0):(ib(this,a),void 0)},Q.prototype={createItem:function(a){if("string"==typeof a.descriptor)return new Y(a,this.docFrag);switch(a.descriptor.t){case Hb:return new V(a,this.docFrag);case Jb:return new X(a,this.docFrag);case Ib:return new W(a,this.docFrag);case Mb:return new R(a,this.docFrag);case Nb:return new T(a,this.docFrag);case Sb:return new U(a,this.docFrag);default:throw new Error("WTF? not sure what happened here...")}},teardown:function(a){var b;if(a&&this.nodes)for(;this.nodes.length;)b=this.nodes.pop(),b.parentNode.removeChild(b);else if(this.items)for(;this.items.length;)this.items.pop().teardown(a)},firstNode:function(){return this.items&&this.items[0]?this.items[0].firstNode():this.nodes?this.nodes[0]||null:null},findNextNode:function(a){var b=a.index;return this.items[b+1]?this.items[b+1].firstNode():this.owner===this.root?null:this.owner.findNextNode(this)},toString:function(){var a,b,c,d;if(this.html)return this.html;if(a="",!this.items)return a;for(c=this.items.length,b=0;c>b;b+=1)d=this.items[b],a+=d.toString();return a}},V=function(a,b){this.type=Hb,b&&(this.node=vb.createTextNode(""),b.appendChild(this.node)),fb(this,a)},V.prototype={update:gb,resolve:hb,teardown:function(a){h(this),a&&this.node.parentNode.removeChild(this.node)},render:function(a){this.node&&(this.node.data=void 0===a?"":a)},firstNode:function(){return this.node},toString:function(){var a=void 0!==this.value?""+this.value:"";return a.replace("<","&lt;").replace(">","&gt;")}},T=function(a,b){var c,d=this.parentFragment=a.parentFragment;this.type=Nb,this.name=a.descriptor.r,c=z(d.root,a.descriptor.r),this.fragment=new Q({descriptor:c,root:d.root,parentNode:d.parentNode,contextStack:d.contextStack,owner:this}),b&&b.appendChild(this.fragment.docFrag)},T.prototype={firstNode:function(){return this.fragment.firstNode()},findNextNode:function(){return this.parentFragment.findNextNode(this)},teardown:function(a){this.fragment.teardown(a)},toString:function(){return this.fragment.toString()}},X=function(a,b){this.type=Jb,this.fragments=[],this.length=0,b&&(this.docFrag=vb.createDocumentFragment()),this.initialising=!0,fb(this,a),b&&b.appendChild(this.docFrag),this.initialising=!1},X.prototype={update:gb,resolve:hb,smartUpdate:function(a,b){var c;("push"===a||"unshift"===a||"splice"===a)&&(c={descriptor:this.descriptor.f,root:this.root,parentNode:this.parentNode,owner:this},this.descriptor.i&&(c.indexRef=this.descriptor.i)),this[a]&&this[a](c,b)},pop:function(){this.length&&(this.fragments.pop().teardown(!0),this.length-=1)},push:function(a,b){var c,d,e;for(c=this.length,d=c+b.length,e=c;d>e;e+=1)a.contextStack=this.contextStack.concat(this.keypath+"."+e),a.index=e,this.fragments[e]=this.createFragment(a);this.length+=b.length,this.parentNode.insertBefore(this.docFrag,this.parentFragment.findNextNode(this))},shift:function(){this.splice(null,[0,1])},unshift:function(a,b){this.splice(a,[0,0].concat(new Array(b.length)))},splice:function(a,b){var c,d,e,f,g,h,i,j,k;if(b.length&&(h=+(b[0]<0?this.length+b[0]:b[0]),d=Math.max(0,b.length-2),e=void 0!==b[1]?b[1]:this.length-h,f=d-e)){if(0>f){for(i=h-f,g=h;i>g;g+=1)this.fragments[g].teardown(!0);
this.fragments.splice(h,-f)}else{for(i=h+f,c=this.fragments[h]?this.fragments[h].firstNode():this.parentFragment.findNextNode(this),j=[h,0].concat(new Array(f)),this.fragments.splice.apply(this.fragments,j),g=h;i>g;g+=1)a.contextStack=this.contextStack.concat(this.keypath+"."+g),a.index=g,this.fragments[g]=this.createFragment(a);this.parentNode.insertBefore(this.docFrag,c)}this.length+=f,k=h+d,x(this.root,this,k,this.length,f)}},teardown:function(a){this.teardownFragments(a),h(this)},firstNode:function(){return this.fragments[0]?this.fragments[0].firstNode():this.parentFragment.findNextNode(this)},findNextNode:function(a){return this.fragments[a.index+1]?this.fragments[a.index+1].firstNode():this.parentFragment.findNextNode(this)},teardownFragments:function(a){for(var b;this.fragments.length;)this.fragments.shift().teardown(a);if(this.fragmentsById)for(b in this.fragmentsById)this.fragments[b]&&(this.fragmentsById[b].teardown(),this.fragmentsById[b]=null)},render:function(a){var b,c;(c=this.root._wrapped[this.keypath])&&(a=c.get()),this.rendering||(this.rendering=!0,jb(this,a),this.rendering=!1,(!this.docFrag||this.docFrag.childNodes.length)&&(this.initialising||(b=this.parentFragment.findNextNode(this),b&&b.parentNode===this.parentNode?this.parentNode.insertBefore(this.docFrag,b):this.parentNode.appendChild(this.docFrag))))},createFragment:function(a){var b=new Q(a);return this.docFrag&&this.docFrag.appendChild(b.docFrag),b},toString:function(){var a,b,c;for(a="",b=0,c=this.length,b=0;c>b;b+=1)a+=this.fragments[b].toString();return a}},Y=function(a,b){this.type=Gb,this.descriptor=a.descriptor,b&&(this.node=vb.createTextNode(a.descriptor),this.parentNode=a.parentFragment.parentNode,b.appendChild(this.node))},Y.prototype={teardown:function(a){a&&this.node.parentNode.removeChild(this.node)},firstNode:function(){return this.node},toString:function(){return(""+this.descriptor).replace("<","&lt;").replace(">","&gt;")}},W=function(a,b){this.type=Ib,b&&(this.nodes=[],this.docFrag=vb.createDocumentFragment()),this.initialising=!0,fb(this,a),b&&b.appendChild(this.docFrag),this.initialising=!1},W.prototype={update:gb,resolve:hb,teardown:function(a){var b;if(a)for(;this.nodes.length;)b=this.nodes.pop(),b.parentNode.removeChild(b);h(this)},firstNode:function(){return this.nodes[0]?this.nodes[0]:this.parentFragment.findNextNode(this)},render:function(a){var b;if(this.nodes){for(;this.nodes.length;)b=this.nodes.pop(),b.parentNode.removeChild(b);if(void 0===a)return this.nodes=[],void 0;this.nodes=w(a,this.parentNode.tagName,this.docFrag),this.initialising||this.parentNode.insertBefore(this.docFrag,this.parentFragment.findNextNode(this))}},toString:function(){return void 0!==this.value?this.value:""}},Z=function(a){ib(this,a)},Z.prototype={createItem:function(a){if("string"==typeof a.descriptor)return new ab(a.descriptor);switch(a.descriptor.t){case Hb:return new $(a);case Ib:return new $(a);case Jb:return new _(a);default:throw"Something went wrong in a rather interesting way"}},bubble:function(){this.owner.bubble()},teardown:function(){var a,b;for(a=this.items.length,b=0;a>b;b+=1)this.items[b].teardown()},getValue:function(){var a;return 1===this.items.length&&this.items[0].type===Hb&&(a=this.items[0].value,void 0!==a)?a:this.toString()},toString:function(){return this.items.join("")},toJSON:function(){var a=this.getValue();if("string"==typeof a)try{a=JSON.parse(a)}catch(b){}return a}},$=function(a){this.type=Hb,fb(this,a)},$.prototype={update:gb,resolve:hb,render:function(a){this.value=a,this.parentFragment.bubble()},teardown:function(){h(this)},toString:function(){return void 0===this.value?"":this.value}},_=function(a){this.type=Jb,this.fragments=[],this.length=0,fb(this,a)},_.prototype={update:gb,resolve:hb,teardown:function(){this.teardownFragments(),h(this)},teardownFragments:function(){for(;this.fragments.length;)this.fragments.shift().teardown();this.length=0},bubble:function(){this.value=this.fragments.join(""),this.parentFragment.bubble()},render:function(a){var b;(b=this.root._wrapped[this.keypath])&&(a=b.get()),jb(this,a),this.parentFragment.bubble()},createFragment:function(a){return new Z(a)},toString:function(){return this.fragments.join("")}},ab=function(a){this.type=Gb,this.text=a},ab.prototype={toString:function(){return this.text},teardown:function(){}},v=function(a){var b;return"undefined"!=typeof window&&vb&&a?a.nodeType?a:"string"==typeof a&&(b=vb.getElementById(a),!b&&vb.querySelector&&(b=vb.querySelector(a)),b.nodeType)?b:a[0]&&a[0].nodeType?a[0]:null:null},q=Object.prototype.toString,r=function(a){return"[object Array]"===q.call(a)},u=function(a,b){return null===a&&null===b?!0:"object"==typeof a||"object"==typeof b?!1:a===b},t=function(a){return!isNaN(parseFloat(a))&&isFinite(a)},s=function(a){return"object"==typeof a&&"[object Object]"===q.call(a)},C=function(a,b){var c,d,e,f;return d=[],e=function(){var a,b;for(a=d.length;a--;)b=d[a],f(b)&&(b.parentNode.removeChild(b),d.splice(a,1))},f=function(a){var b,d;for(b=c.active.length;b--;)if(d=c.active[b],a.contains(d))return!1;return!0},c={active:[],push:function(a){c.active[c.active.length]=a},pop:function(a){c.active.splice(c.active.indexOf(a),1),e(),!c.active.length&&c._ready&&c.complete()},complete:function(){b&&b.call(a)},ready:function(){e(),c._ready=!0,c.active.length||c.complete()},detachWhenReady:function(a){d[d.length]=a}}};var Bc;!function(){var a=/\[\s*([0-9]|[1-9][0-9]+)\s*\]/g;Bc=function(b){return b.replace(a,".$1")}}();var Cc;!function(){var a,b,c,d,e,f,g,h,i,j,k,l,m,n,o,p;Cc=function(b,c,d){var f,g,h,j,o,q,r;if(this.lcTag=b.name.toLowerCase(),c.pos+=1,"rv-"===this.lcTag.substr(0,3)){if(this.component=p(b.name.substring(3)),b.attrs)for(this.attributes=[],q=b.attrs.length;q--;)r=b.attrs[q],this.attributes[q]={name:r.name,value:r.value?nb(r.value):null}}else this.tag=e[this.lcTag]?e[this.lcTag]:this.lcTag,d=d||"pre"===this.lcTag,b.attrs&&(h=l(b.attrs),g=h.attrs,j=h.proxies,c.options.sanitize&&c.options.sanitize.eventAttributes&&(g=g.filter(k)),g.length&&(this.attributes=g.map(m)),j.length&&(this.proxies=j.map(n)),h.intro&&(this.intro=n(h.intro)),h.outro&&(this.outro=n(h.outro)));if(b.selfClosing&&(this.selfClosing=!0),-1!==a.indexOf(this.lcTag)&&(this.isVoid=!0),!this.selfClosing&&!this.isVoid){for(this.siblings=i[this.lcTag],this.items=[],f=c.next();f&&f.mustacheType!==Lb;){if(f.type===Rb){if(f.closing){f.name.toLowerCase()===this.lcTag&&(c.pos+=1);break}if(this.siblings&&-1!==this.siblings.indexOf(f.name.toLowerCase()))break}this.items[this.items.length]=nc(c),f=c.next()}d||(o=this.items[0],o&&o.type===Gb&&(o.text=o.text.replace(Db,""),o.text||this.items.shift()),o=this.items[this.items.length-1],o&&o.type===Gb&&(o.text=o.text.replace(Eb,""),o.text||this.items.pop()))}},Cc.prototype={toJSON:function(a){var b,c,d,e,f,g;if(this["json_"+a])return this["json_"+a];if(b=this.component?{t:Sb,e:this.component}:{t:Mb,e:this.tag},this.attributes&&this.attributes.length)for(b.a={},g=this.attributes.length,f=0;g>f;f+=1){if(c=this.attributes[f].name,b.a[c])throw new Error("You cannot have multiple attributes with the same name");d=null===this.attributes[f].value?null:oc(this.attributes[f].value.items,a),b.a[c]=d}if(this.items&&this.items.length&&(b.f=oc(this.items,a)),this.proxies&&this.proxies.length)for(b.v={},g=this.proxies.length,f=0;g>f;f+=1)e=this.proxies[f],b.v[e.domEventName]=o(e);return this.intro&&(b.t1=this.intro.args?{n:this.intro.name,a:this.intro.args}:this.intro.dynamicArgs?{n:this.intro.name,d:oc(this.intro.dynamicArgs.items,a)}:this.intro.name),this.outro&&(b.t2=this.outro.args?{n:this.outro.name,a:this.outro.args}:this.outro.dynamicArgs?{n:this.outro.name,d:oc(this.outro.dynamicArgs.items,a)}:this.outro.name),this["json_"+a]=b,b},toString:function(){var c,d,e,f,g,h,i,j;if(void 0!==this.str)return this.str;if(this.component)return this.str=!1;if(-1===b.indexOf(this.tag.toLowerCase()))return this.str=!1;if(this.proxies||this.intro||this.outro)return this.str=!1;if(i=pc(this.items),i===!1)return this.str=!1;if(j=-1!==a.indexOf(this.tag.toLowerCase()),c="<"+this.tag,this.attributes)for(d=0,e=this.attributes.length;e>d;d+=1){if(g=this.attributes[d].name,-1!==g.indexOf(":"))return this.str=!1;if("id"===g||"intro"===g||"outro"===g)return this.str=!1;if(f=" "+g,null!==this.attributes[d].value){if(h=this.attributes[d].value.toString(),h===!1)return this.str=!1;""!==h&&(f+="=",f+=/[\s"'=<>`]/.test(h)?'"'+h.replace(/"/g,"&quot;")+'"':h)}c+=f}return this.selfClosing&&!j?(c+="/>",this.str=c):(c+=">",j?this.str=c:(c+=i,c+="</"+this.tag+">",this.str=c))}},a="area base br col command embed hr img input keygen link meta param source track wbr".split(" "),b="a abbr acronym address applet area b base basefont bdo big blockquote body br button caption center cite code col colgroup dd del dfn dir div dl dt em fieldset font form frame frameset h1 h2 h3 h4 h5 h6 head hr html i iframe img input ins isindex kbd label legend li link map menu meta noframes noscript object ol p param pre q s samp script select small span strike strong style sub sup textarea title tt u ul var article aside audio bdi canvas command data datagrid datalist details embed eventsource figcaption figure footer header hgroup keygen mark meter nav output progress ruby rp rt section source summary time track video wbr".split(" "),h="li dd rt rp optgroup option tbody tfoot tr td th".split(" "),d="altGlyph altGlyphDef altGlyphItem animateColor animateMotion animateTransform clipPath feBlend feColorMatrix feComponentTransfer feComposite feConvolveMatrix feDiffuseLighting feDisplacementMap feDistantLight feFlood feFuncA feFuncB feFuncG feFuncR feGaussianBlur feImage feMerge feMergeNode feMorphology feOffset fePointLight feSpecularLighting feSpotLight feTile feTurbulence foreignObject glyphRef linearGradient radialGradient textPath vkern".split(" "),f="attributeName attributeType baseFrequency baseProfile calcMode clipPathUnits contentScriptType contentStyleType diffuseConstant edgeMode externalResourcesRequired filterRes filterUnits glyphRef glyphRef gradientTransform gradientTransform gradientUnits gradientUnits kernelMatrix kernelUnitLength kernelUnitLength kernelUnitLength keyPoints keySplines keyTimes lengthAdjust limitingConeAngle markerHeight markerUnits markerWidth maskContentUnits maskUnits numOctaves pathLength patternContentUnits patternTransform patternUnits pointsAtX pointsAtY pointsAtZ preserveAlpha preserveAspectRatio primitiveUnits refX refY repeatCount repeatDur requiredExtensions requiredFeatures specularConstant specularExponent specularExponent spreadMethod spreadMethod startOffset stdDeviation stitchTiles surfaceScale surfaceScale systemLanguage tableValues targetX targetY textLength textLength viewBox viewTarget xChannelSelector yChannelSelector zoomAndPan".split(" "),c=function(a){for(var b={},c=a.length;c--;)b[a[c].toLowerCase()]=a[c];return b},e=c(d),g=c(f),i={li:["li"],dt:["dt","dd"],dd:["dt","dd"],p:"address article aside blockquote dir div dl fieldset footer form h1 h2 h3 h4 h5 h6 header hgroup hr menu nav ol p pre section table ul".split(" "),rt:["rt","rp"],rp:["rp","rt"],optgroup:["optgroup"],option:["option","optgroup"],thead:["tbody","tfoot"],tbody:["tbody","tfoot"],tr:["tr"],td:["td","th"],th:["td","th"]},j=/^on[a-zA-Z]/,k=function(a){var b=!j.test(a.name);return b},l=function(a){var b,c,d,e,f,g;for(d={},b=[],c=[],f=a.length,e=0;f>e;e+=1)if(g=a[e],"intro"===g.name){if(d.intro)throw new Error("An element can only have one intro transition");d.intro=g}else if("outro"===g.name){if(d.outro)throw new Error("An element can only have one outro transition");d.outro=g}else"proxy-"===g.name.substr(0,6)?(g.name=g.name.substring(6),c[c.length]=g):"on-"===g.name.substr(0,3)?(g.name=g.name.substring(3),c[c.length]=g):b[b.length]=g;return d.attrs=b,d.proxies=c,d},m=function(a){var b=a.name.toLowerCase();return{name:g[b]?g[b]:b,value:a.value?nb(a.value):null}},n=function(a){var b,c,d,e,f,g,h;for(f=function(){throw new Error("Illegal proxy event")},a.name&&a.value||f(),b={domEventName:a.name},c=a.value,g=[],h=[];c.length;)if(d=c.shift(),d.type===Gb){if(e=d.value.indexOf(":"),-1!==e){e&&(g[g.length]={type:Gb,value:d.value.substr(0,e)}),d.value.length>e+1&&(h[0]={type:Gb,value:d.value.substring(e+1)});break}g[g.length]=d}else g[g.length]=d;if(h=h.concat(c),b.name=1===g.length&&g[0].type===Gb?g[0].value:g,h.length)if(1===h.length&&h[0].type===Gb)try{b.args=JSON.parse(h[0].value)}catch(i){b.args=h[0].value}else b.dynamicArgs=h;return b},o=function(a){var b,c;if("string"==typeof a.name){if(!a.args&&!a.dynamicArgs)return a.name;c=a.name}else c=nb(a.name).toJSON();return b={n:c},a.args?(b.a=a.args,b):(a.dynamicArgs&&(b.d=nb(a.dynamicArgs).toJSON()),b)},p=function(a){return a.replace(/-([a-zA-Z])/g,function(a,b){return b.toUpperCase()})}}();var Dc;!function(){var a,b,c,d;Dc=function(c){this.refs=[],a(c,this.refs),this.str=b(c,this.refs)},Dc.prototype={toJSON:function(){return this.json?this.json:(this.json={r:this.refs,s:this.str},this.json)}},a=function(b,c){var d,e;if(b.t===$b&&-1===c.indexOf(b.n)&&c.unshift(b.n),e=b.o||b.m)if(s(e))a(e,c);else for(d=e.length;d--;)a(e[d],c);b.x&&a(b.x,c),b.r&&a(b.r,c),b.v&&a(b.v,c)},b=function(a,d){var e=function(a){return b(a,d)};switch(a.t){case Xb:case Yb:case Tb:return a.v;case Ub:return"'"+a.v.replace(/'/g,"\\'")+"'";case Vb:return"["+(a.m?a.m.map(e).join(","):"")+"]";case Wb:return"{"+(a.m?a.m.map(e).join(","):"")+"}";case Zb:return c(a.k)+":"+b(a.v,d);case bc:return("typeof"===a.s?"typeof ":a.s)+b(a.o,d);case ec:return b(a.o[0],d)+("in"===a.s.substr(0,2)?" "+a.s+" ":a.s)+b(a.o[1],d);case fc:return b(a.x,d)+"("+(a.o?a.o.map(e).join(","):"")+")";case cc:return"("+b(a.x,d)+")";case ac:return b(a.x,d)+b(a.r,d);case _b:return a.n?"."+a.n:"["+b(a.x,d)+"]";case dc:return b(a.o[0],d)+"?"+b(a.o[1],d)+":"+b(a.o[2],d);case $b:return"${"+d.indexOf(a.n)+"}";default:throw Cb.log(a),new Error("Could not stringify expression token. This error is unexpected")}},c=function(a){return a.t===Ub?d.test(a.v)?a.v:'"'+a.v.replace(/"/g,'\\"')+'"':a.t===Tb?a.v:a},d=/^[a-zA-Z_$][a-zA-Z_$0-9]*$/}();var Ec=function(a,b){var c,d;for(c=this.items=[],d=nc(a,b);null!==d;)c[c.length]=d,d=nc(a,b)};Ec.prototype={toJSON:function(a){var b;return this["json_"+a]?this["json_"+a]:b=this["json_"+a]=oc(this.items,a)},toString:function(){return void 0!==this.str?this.str:(this.str=pc(this.items),this.str)}};var Fc=function(a,b){this.type=a.type===Ib?Ib:a.mustacheType,a.ref&&(this.ref=a.ref),a.expression&&(this.expr=new Dc(a.expression)),b.pos+=1};Fc.prototype={toJSON:function(){var a;return this.json?this.json:(a={t:this.type},this.ref&&(a.r=this.ref),this.expr&&(a.x=this.expr.toJSON()),this.json=a,a)},toString:function(){return!1}};var Gc=function(a,b,c){var d;for(this.ref=a.ref,this.indexRef=a.indexRef,this.inverted=a.mustacheType===Kb,a.expression&&(this.expr=new Dc(a.expression)),b.pos+=1,this.items=[],d=b.next();d;){if(d.mustacheType===Lb){if(d.ref.trim()===this.ref||this.expr){b.pos+=1;break}throw new Error("Could not parse template: Illegal closing section")}this.items[this.items.length]=nc(b,c),d=b.next()}};Gc.prototype={toJSON:function(a){var b;return this.json?this.json:(b={t:Jb},this.ref&&(b.r=this.ref),this.indexRef&&(b.i=this.indexRef),this.inverted&&(b.n=!0),this.expr&&(b.x=this.expr.toJSON()),this.items.length&&(b.f=oc(this.items,a)),this.json=b,b)},toString:function(){return!1}};var Hc;!function(){var a,b,c,d,e,f,g,h;Hc=function(a,b){this.type=Gb,this.text=b?a.value:a.value.replace(h," ")},Hc.prototype={toJSON:function(){return this.decoded||(this.decoded=g(this.text))},toString:function(){return this.text}},a={quot:34,amp:38,apos:39,lt:60,gt:62,nbsp:160,iexcl:161,cent:162,pound:163,curren:164,yen:165,brvbar:166,sect:167,uml:168,copy:169,ordf:170,laquo:171,not:172,shy:173,reg:174,macr:175,deg:176,plusmn:177,sup2:178,sup3:179,acute:180,micro:181,para:182,middot:183,cedil:184,sup1:185,ordm:186,raquo:187,frac14:188,frac12:189,frac34:190,iquest:191,Agrave:192,Aacute:193,Acirc:194,Atilde:195,Auml:196,Aring:197,AElig:198,Ccedil:199,Egrave:200,Eacute:201,Ecirc:202,Euml:203,Igrave:204,Iacute:205,Icirc:206,Iuml:207,ETH:208,Ntilde:209,Ograve:210,Oacute:211,Ocirc:212,Otilde:213,Ouml:214,times:215,Oslash:216,Ugrave:217,Uacute:218,Ucirc:219,Uuml:220,Yacute:221,THORN:222,szlig:223,agrave:224,aacute:225,acirc:226,atilde:227,auml:228,aring:229,aelig:230,ccedil:231,egrave:232,eacute:233,ecirc:234,euml:235,igrave:236,iacute:237,icirc:238,iuml:239,eth:240,ntilde:241,ograve:242,oacute:243,ocirc:244,otilde:245,ouml:246,divide:247,oslash:248,ugrave:249,uacute:250,ucirc:251,uuml:252,yacute:253,thorn:254,yuml:255,OElig:338,oelig:339,Scaron:352,scaron:353,Yuml:376,fnof:402,circ:710,tilde:732,Alpha:913,Beta:914,Gamma:915,Delta:916,Epsilon:917,Zeta:918,Eta:919,Theta:920,Iota:921,Kappa:922,Lambda:923,Mu:924,Nu:925,Xi:926,Omicron:927,Pi:928,Rho:929,Sigma:931,Tau:932,Upsilon:933,Phi:934,Chi:935,Psi:936,Omega:937,alpha:945,beta:946,gamma:947,delta:948,epsilon:949,zeta:950,eta:951,theta:952,iota:953,kappa:954,lambda:955,mu:956,nu:957,xi:958,omicron:959,pi:960,rho:961,sigmaf:962,sigma:963,tau:964,upsilon:965,phi:966,chi:967,psi:968,omega:969,thetasym:977,upsih:978,piv:982,ensp:8194,emsp:8195,thinsp:8201,zwnj:8204,zwj:8205,lrm:8206,rlm:8207,ndash:8211,mdash:8212,lsquo:8216,rsquo:8217,sbquo:8218,ldquo:8220,rdquo:8221,bdquo:8222,dagger:8224,Dagger:8225,bull:8226,hellip:8230,permil:8240,prime:8242,Prime:8243,lsaquo:8249,rsaquo:8250,oline:8254,frasl:8260,euro:8364,image:8465,weierp:8472,real:8476,trade:8482,alefsym:8501,larr:8592,uarr:8593,rarr:8594,darr:8595,harr:8596,crarr:8629,lArr:8656,uArr:8657,rArr:8658,dArr:8659,hArr:8660,forall:8704,part:8706,exist:8707,empty:8709,nabla:8711,isin:8712,notin:8713,ni:8715,prod:8719,sum:8721,minus:8722,lowast:8727,radic:8730,prop:8733,infin:8734,ang:8736,and:8743,or:8744,cap:8745,cup:8746,"int":8747,there4:8756,sim:8764,cong:8773,asymp:8776,ne:8800,equiv:8801,le:8804,ge:8805,sub:8834,sup:8835,nsub:8836,sube:8838,supe:8839,oplus:8853,otimes:8855,perp:8869,sdot:8901,lceil:8968,rceil:8969,lfloor:8970,rfloor:8971,lang:9001,rang:9002,loz:9674,spades:9824,clubs:9827,hearts:9829,diams:9830},b=[8364,129,8218,402,8222,8230,8224,8225,710,8240,352,8249,338,141,381,143,144,8216,8217,8220,8221,8226,8211,8212,732,8482,353,8250,339,157,382,376],c=new RegExp("&("+Object.keys(a).join("|")+");?","g"),d=/&#x([0-9]+);?/g,e=/&#([0-9]+);?/g,f=function(a){return a?10===a?32:128>a?a:159>=a?b[a-128]:55296>a?a:57343>=a?65533:65535>=a?a:65533:65533},g=function(b){var g;return g=b.replace(c,function(b,c){return a[c]?String.fromCharCode(a[c]):b}),g=g.replace(d,function(a,b){return String.fromCharCode(f(parseInt(b,16)))}),g=g.replace(e,function(a,b){return String.fromCharCode(f(b))})},h=/\s+/g}(),nb=function(a,b,c){var d,e;return d={pos:0,tokens:a||[],next:function(){return d.tokens[d.pos]},options:b},e=new Ec(d,c)};var Ic;!function(){var a,b,c,d,e,f,g,h,i,j,k,l,m,n,o,p,q,r,s,t,u,v,w,x,y,z,A,B,C;Ic=function(a){return i(a)},a=function(b){var c,d,e,f;if(c=b.pos,qc(b),e=Ic(b),null===e)return null;if(d=[e],qc(b),tc(b,",")){if(f=a(b),null===f)return b.pos=c,null;d=d.concat(f)}return d},d=function(a){var b,c;return b=a.pos,tc(a,"(")?(qc(a),(c=Ic(a))?(qc(a),tc(a,")")?{t:cc,x:c}:(a.pos=b,null)):(a.pos=b,null)):null},e=function(a){return p(a)||n(a)||d(a)},f=function(b){var c,d,f,g;if(d=e(b),!d)return null;for(;d;)if(c=b.pos,f=o(b))d={t:ac,x:d,r:f};else{if(!tc(b,"("))break;if(qc(b),g=a(b),qc(b),!tc(b,")")){b.pos=c;break}d={t:fc,x:d},g&&(d.o=g)}return d},b=function(a,b){return function(c){var d,e;return tc(c,a)?(d=c.pos,qc(c),e=Ic(c),e||rc(c,"an expression"),{s:a,o:e,t:bc}):b(c)}},function(){var a,c,d,e,h;for(e="! ~ + - typeof".split(" "),h=f,a=0,c=e.length;c>a;a+=1)d=b(e[a],h),h=d;g=h}(),c=function(a,b){return function(c){var d,e,f;return(e=b(c))?(d=c.pos,qc(c),tc(c,a)?"in"===a&&/[a-zA-Z_$0-9]/.test(c.remaining().charAt(0))?(c.pos=d,e):(qc(c),f=Ic(c),f?{t:ec,s:a,o:[e,f]}:(c.pos=d,e)):(c.pos=d,e)):null}},function(){var a,b,d,e,f;for(e="* / % + - << >> >>> < <= > >= in instanceof == != === !== & ^ | && ||".split(" "),f=g,a=0,b=e.length;b>a;a+=1)d=c(e[a],f),f=d;h=f}(),i=function(a){var b,c,d,e;return(c=h(a))?(b=a.pos,qc(a),tc(a,"?")?(qc(a),(d=Ic(a))?(qc(a),tc(a,":")?(qc(a),e=Ic(a),e?{t:dc,o:[c,d,e]}:(a.pos=b,c)):(a.pos=b,c)):(a.pos=b,c)):(a.pos=b,c)):null},j=sc(/^[0-9]+/),k=sc(/^[eE][\-+]?[0-9]+/),l=sc(/^\.[0-9]+/),m=sc(/^(0|[1-9][0-9]*)/),C=/^(?:Array|Date|RegExp|decodeURIComponent|decodeURI|encodeURIComponent|encodeURI|isFinite|isNaN|parseFloat|parseInt|JSON|Math|NaN|undefined|null)$/,n=function(a){var b,c,d,e,f,g,h;for(b=a.pos,c="";tc(a,"../");)c+="../";if(c||(e=tc(a,".")||""),d=y(a)||"",!c&&!e&&C.test(d))return{t:Yb,v:d};if("this"!==d||c||e||(d=".",b+=3),f=(c||e)+d,!f)return null;for(;g=z(a)||A(a);)f+=g;return tc(a,"(")&&(h=f.lastIndexOf("."),-1!==h?(f=f.substr(0,h),a.pos=b+f.length):a.pos-=1),{t:$b,n:f}},o=function(a){var b,c,d;if(b=a.pos,qc(a),tc(a,".")){if(qc(a),c=y(a))return{t:_b,n:c};rc(a,"a property name")}return tc(a,"[")?(qc(a),d=Ic(a),d||rc(a,"an expression"),qc(a),tc(a,"]")||rc(a,'"]"'),{t:_b,x:d}):null},p=function(a){var b=s(a)||r(a)||t(a)||u(a)||q(a);return b},q=function(b){var c,d;return c=b.pos,qc(b),tc(b,"[")?(d=a(b),tc(b,"]")?{t:Vb,m:d}:(b.pos=c,null)):(b.pos=c,null)},r=function(a){var b=a.remaining();return"true"===b.substr(0,4)?(a.pos+=4,{t:Xb,v:"true"}):"false"===b.substr(0,5)?(a.pos+=5,{t:Xb,v:"false"}):null},s=function(a){var b,c;return b=a.pos,(c=l(a))?{t:Tb,v:c}:(c=m(a),null===c?null:(c+=l(a)||"",c+=k(a)||"",{t:Tb,v:c}))},u=function(a){var b,c;return b=a.pos,qc(a),tc(a,"{")?(c=v(a),qc(a),tc(a,"}")?{t:Wb,m:c}:(a.pos=b,null)):(a.pos=b,null)},v=function(a){var b,c,d,e;return b=a.pos,d=w(a),null===d?null:(c=[d],tc(a,",")?(e=v(a),e?c.concat(e):(a.pos=b,null)):c)},w=function(a){var b,c,d;return b=a.pos,qc(a),c=x(a),null===c?(a.pos=b,null):(qc(a),tc(a,":")?(qc(a),d=Ic(a),null===d?(a.pos=b,null):{t:Zb,k:c,v:d}):(a.pos=b,null))},x=function(a){return y(a)||t(a)||s(a)},t=function(a){var b,c;return b=a.pos,tc(a,'"')?(c=Mc(a),tc(a,'"')?{t:Ub,v:c}:(a.pos=b,null)):tc(a,"'")?(c=Rc(a),tc(a,"'")?{t:Ub,v:c}:(a.pos=b,null)):null},y=sc(/^[a-zA-Z_$][a-zA-Z_$0-9]*/),z=sc(/^\.[a-zA-Z_$0-9]+/),A=function(a){var b=B(a);return b?"."+b:null},B=sc(/^\[(0|[1-9][0-9]*)\]/)}();var Jc;!function(){var a,b,c,d,e,f,g,h;Jc=function(c){return c.tripleDelimiters[0].length>c.delimiters[0].length?b(c)||a(c):a(c)||b(c)},a=function(a){var b,d=a.pos;return tc(a,a.delimiters[0])?(b=h(a))?tc(a,a.delimiters[1])?(a.delimiters=b,{type:Qb,mustacheType:Pb}):(a.pos=d,null):(b=c(a),null===b?(a.pos=d,null):(qc(a),tc(a,a.delimiters[1])||rc(a,'"'+a.delimiters[1]+'"'),b)):null},b=function(a){var b,d=a.pos;return tc(a,a.tripleDelimiters[0])?(b=h(a))?tc(a,a.tripleDelimiters[1])?(a.tripleDelimiters=b,{type:Qb,mustacheType:Pb}):(a.pos=d,null):(qc(a),b=c(a,!0),null===b?(a.pos=d,null):(qc(a),tc(a,a.tripleDelimiters[1])?b:(a.pos=d,null))):null},c=function(a,b){var c,f,g,h,i,j,k;if(c=a.pos,f={type:b?Ib:Qb},!b&&(g=d(a),f.mustacheType=g||Hb,(g===Ob||g===Lb)&&(j=a.remaining(),k=j.indexOf(a.delimiters[1]),-1!==k)))return f.ref=j.substr(0,k),a.pos+=k,f;for(qc(a),h=Ic(a);h.t===cc&&h.x;)h=h.x;return h.t===$b?f.ref=h.n:f.expression=h,i=e(a),null!==i&&(f.indexRef=i),f},f={"#":Jb,"^":Kb,"/":Lb,">":Nb,"!":Ob,"&":Hb},d=function(a){var b=f[a.str.charAt(a.pos)];return b?(a.pos+=1,b):null},e=sc(/^\s*:\s*([a-zA-Z_$][a-zA-Z_$0-9]*)/),g=sc(/^[^\s=]+/),h=function(a){var b,c,d;return tc(a,"=")?(b=a.pos,qc(a),(c=g(a))?(qc(a),(d=g(a))?(qc(a),tc(a,"=")?[c,d]:(a.pos=b,null)):(a.pos=b,null)):(a.pos=b,null)):null}}();var Kc;!function(){var a,b,c,d,e,f,g,h,i,j,k,l;Kc=function(c){return a(c)||b(c)},a=function(a){var b,e,f;return b=a.pos,tc(a,"<")?(e={type:Rb},e.name=c(a),e.name?(f=d(a),f&&(e.attrs=f),qc(a),tc(a,"/")&&(e.selfClosing=!0),tc(a,">")?e:(a.pos=b,null)):(a.pos=b,null)):null},b=function(a){var b,d;if(b=a.pos,!tc(a,"<"))return null;if(d={type:Rb,closing:!0},!tc(a,"/"))throw new Error("Unexpected character "+a.remaining().charAt(0)+' (expected "/")');if(d.name=c(a),!d.name)throw new Error("Unexpected character "+a.remaining().charAt(0)+" (expected tag name)");if(!tc(a,">"))throw new Error("Unexpected character "+a.remaining().charAt(0)+' (expected ">")');return d},c=sc(/^[a-zA-Z][a-zA-Z0-9\-]*/),d=function(a){var b,c,d;if(b=a.pos,qc(a),d=e(a),!d)return a.pos=b,null;for(c=[];null!==d;)c[c.length]=d,qc(a),d=e(a);return c},e=function(a){var b,c,d;return(c=f(a))?(b={name:c},d=g(a),d&&(b.value=d),b):null},f=sc(/^[^\s"'>\/=]+/),g=function(a){var b,c;return b=a.pos,qc(a),tc(a,"=")?(qc(a),c=l(a,"'")||l(a,'"')||h(a),null===c?(a.pos=b,null):c):(a.pos=b,null)},j=sc(/^[^\s"'=<>`]+/),i=function(a){var b,c,d;return b=a.pos,(c=j(a))?(-1!==(d=c.indexOf(a.delimiters[0]))&&(c=c.substr(0,d),a.pos=b+c.length),{type:Gb,value:c}):null},h=function(a){var b,c;for(b=[],c=Jc(a)||i(a);null!==c;)b[b.length]=c,c=Jc(a)||i(a);return b.length?b:null},l=function(a,b){var c,d,e;if(c=a.pos,!tc(a,b))return null;for(d=[],e=Jc(a)||k(a,b);null!==e;)d[d.length]=e,e=Jc(a)||k(a,b);return tc(a,b)?d:(a.pos=c,null)},k=function(a,b){var c,d,e;if(c=a.pos,e=a.remaining(),d=Qc(e,[b,a.delimiters[0],a.delimiters[1]]),-1===d)throw new Error("Quoted attribute value must have a closing quote");return d?(a.pos+=d,{type:Gb,value:e.substr(0,d)}):null}}();var Lc=function(a){var b,c;return c=a.remaining(),(b=Qc(c,["<",a.delimiters[0],a.tripleDelimiters[0]]))?(-1===b&&(b=c.length),a.pos+=b,{type:Gb,value:c.substr(0,b)}):null};ob=function(a){var b=Jc(a)||Kc(a)||Lc(a);return b};var Mc=function(a){var b,c,d,e,f;if(b=a.pos,c="",d=Pc(a),d&&(c+=d),e=Nc(a),e&&(c+=e),!c)return"";for(f=Mc(a);""!==f;)c+=f;return c},Nc=sc(/^[^\\"]+/),Oc=function(a){var b;return tc(a,"\\")?(b=a.str.charAt(a.pos),a.pos+=1,b):null},Pc=function(a){var b,c="";for(b=Oc(a);b;)c+=b,b=Oc(a);return c||null},Qc=function(a,b){var c,d,e;for(c=b.length;c--;){if(d=a.indexOf(b[c]),!d)return 0;-1!==d&&(!e||e>d)&&(e=d)}return e||-1},Rc=function(a){var b,c,d,e,f;if(b=a.pos,c="",d=Pc(a),d&&(c+=d),e=Sc(a),e&&(c+=e),c)for(f=Rc(a);f;)c+=f,f=Rc(a);return c},Sc=sc(/^[^\\']+/);!function(){var a,b,c,d;a=/^\s*$/,b=/<!--\s*\{\{\s*>\s*([a-zA-Z_$][a-zA-Z_$0-9]*)\s*}\}\s*-->/,c=/<!--\s*\{\{\s*\/\s*([a-zA-Z_$][a-zA-Z_$0-9]*)\s*}\}\s*-->/,e=function(c,e){var f,g,h,i;return e=e||{},b.test(c)?d(c,e):(e.sanitize===!0&&(e.sanitize={elements:"applet base basefont body frame frameset head html isindex link meta noframes noscript object param script style title".split(" "),eventAttributes:!0}),f=pb(c,e),e.preserveWhitespace||(i=f[0],i&&i.type===Gb&&a.test(i.value)&&f.shift(),i=f[f.length-1],i&&i.type===Gb&&a.test(i.value)&&f.pop()),g=nb(f,e,e.preserveWhitespace),h=g.toJSON(),"string"==typeof h?[h]:h)},d=function(a,d){var f,g,h,i,j,k;for(h={},f="",g=a;j=b.exec(g);){if(i=j[1],f+=g.substr(0,j.index),g=g.substring(j.index+j[0].length),k=c.exec(g),!k||k[1]!==i)throw new Error("Inline partials must have a closing delimiter, and cannot be nested");h[i]=e(g.substr(0,k.index),d),g=g.substring(k.index+k[0].length)}return{main:e(f,d),partials:h}}}(),pb=function(a,c){var d,e,f,g,h;for(c=c||{},d={str:rb(a),pos:0,delimiters:c.delimiters||b.delimiters,tripleDelimiters:c.tripleDelimiters||b.tripleDelimiters,remaining:function(){return d.str.substring(d.pos)}},e=[];d.pos<d.str.length;){if(f=ob(d),null===f&&d.remaining())throw g=d.str.substr(0,d.pos).substr(-20),20===g.length&&(g="..."+g),h=d.remaining().substr(0,20),20===h.length&&(h+="..."),new Error("Could not parse template: "+(g?g+"<- ":"")+"failed at character "+d.pos+" ->"+h);e[e.length]=f}return sb(e),qb(e),e},b.prototype=wb,b.partials={},b.delimiters=["{{","}}"],b.tripleDelimiters=["{{{","}}}"],b.adaptors=xb,b.eventDefinitions=yb,b.easing=c,b.transitions=zb,b.extend=d,b.interpolate=f,b.interpolators=g,b.parse=e,b.VERSION=ub,"undefined"!=typeof module&&module.exports?module.exports=b:"function"==typeof define&&define.amd?define('Ractive',[],function(){return b}):a.Ractive=b}("undefined"!=typeof window?window:this);
!function(a,b){if("undefined"!=typeof module&&module.exports&&"function"==typeof require)b(require("ractive"),require("backbone"));else if("function"==typeof define&&define.amd)define('Ractive-Backbone',["Ractive","Backbone"],b);else{if(!a.Ractive||!a.Backbone)throw new Error("Could not find Ractive or Backbone! Both must be loaded before the Ractive-Backbone plugin");b(a.Ractive,a.Backbone)}}("undefined"!=typeof window?window:this,function(a,b){var c,d;if(!a||!b)throw new Error("Could not find Ractive or Backbone! Check your paths config");a.adaptors.Backbone={filter:function(a){return a instanceof b.Model||a instanceof b.Collection},wrap:function(a,e,f,g){return e instanceof b.Model?new c(a,e,f,g):new d(a,e,f,g)}},c=function(a,b,c,d){var e=this;this.value=b,b.on("change",this.modelChangeHandler=function(){e.setting=!0,a.set(d(b.changed)),e.setting=!1})},c.prototype={teardown:function(){this.value.off("change",this.changeHandler)},get:function(){return this.value.attributes},set:function(a,b){this.setting||-1!==a.indexOf(".")||this.value.set(a,b)},reset:function(a){return a instanceof b.Model||"object"!=typeof a?!1:(this.value.reset(a),void 0)}},d=function(a,b,c){var d=this;this.value=b,b.on("add remove reset sort",this.changeHandler=function(){d.setting=!0,a.set(c,b.models),d.setting=!1})},d.prototype={teardown:function(){this.value.off("add remove reset sort",this.changeHandler)},get:function(){return this.value.models},reset:function(a){return this.setting?void 0:a instanceof b.Collection||"[object Array]"!==Object.prototype.toString.call(a)?!1:(this.value.reset(a),void 0)}}});
/* Copyright (c) 2010-2013 Marcus Westin */
this.JSON||(this.JSON={}),function(){function f(e){return e<10?"0"+e:e}function quote(e){return escapable.lastIndex=0,escapable.test(e)?'"'+e.replace(escapable,function(e){var t=meta[e];return typeof t=="string"?t:"\\u"+("0000"+e.charCodeAt(0).toString(16)).slice(-4)})+'"':'"'+e+'"'}function str(e,t){var n,r,i,s,o=gap,u,a=t[e];a&&typeof a=="object"&&typeof a.toJSON=="function"&&(a=a.toJSON(e)),typeof rep=="function"&&(a=rep.call(t,e,a));switch(typeof a){case"string":return quote(a);case"number":return isFinite(a)?String(a):"null";case"boolean":case"null":return String(a);case"object":if(!a)return"null";gap+=indent,u=[];if(Object.prototype.toString.apply(a)==="[object Array]"){s=a.length;for(n=0;n<s;n+=1)u[n]=str(n,a)||"null";return i=u.length===0?"[]":gap?"[\n"+gap+u.join(",\n"+gap)+"\n"+o+"]":"["+u.join(",")+"]",gap=o,i}if(rep&&typeof rep=="object"){s=rep.length;for(n=0;n<s;n+=1)r=rep[n],typeof r=="string"&&(i=str(r,a),i&&u.push(quote(r)+(gap?": ":":")+i))}else for(r in a)Object.hasOwnProperty.call(a,r)&&(i=str(r,a),i&&u.push(quote(r)+(gap?": ":":")+i));return i=u.length===0?"{}":gap?"{\n"+gap+u.join(",\n"+gap)+"\n"+o+"}":"{"+u.join(",")+"}",gap=o,i}}typeof Date.prototype.toJSON!="function"&&(Date.prototype.toJSON=function(e){return isFinite(this.valueOf())?this.getUTCFullYear()+"-"+f(this.getUTCMonth()+1)+"-"+f(this.getUTCDate())+"T"+f(this.getUTCHours())+":"+f(this.getUTCMinutes())+":"+f(this.getUTCSeconds())+"Z":null},String.prototype.toJSON=Number.prototype.toJSON=Boolean.prototype.toJSON=function(e){return this.valueOf()});var cx=/[\u0000\u00ad\u0600-\u0604\u070f\u17b4\u17b5\u200c-\u200f\u2028-\u202f\u2060-\u206f\ufeff\ufff0-\uffff]/g,escapable=/[\\\"\x00-\x1f\x7f-\x9f\u00ad\u0600-\u0604\u070f\u17b4\u17b5\u200c-\u200f\u2028-\u202f\u2060-\u206f\ufeff\ufff0-\uffff]/g,gap,indent,meta={"\b":"\\b","	":"\\t","\n":"\\n","\f":"\\f","\r":"\\r",'"':'\\"',"\\":"\\\\"},rep;typeof JSON.stringify!="function"&&(JSON.stringify=function(e,t,n){var r;gap="",indent="";if(typeof n=="number")for(r=0;r<n;r+=1)indent+=" ";else typeof n=="string"&&(indent=n);rep=t;if(!t||typeof t=="function"||typeof t=="object"&&typeof t.length=="number")return str("",{"":e});throw new Error("JSON.stringify")}),typeof JSON.parse!="function"&&(JSON.parse=function(text,reviver){function walk(e,t){var n,r,i=e[t];if(i&&typeof i=="object")for(n in i)Object.hasOwnProperty.call(i,n)&&(r=walk(i,n),r!==undefined?i[n]=r:delete i[n]);return reviver.call(e,t,i)}var j;text=String(text),cx.lastIndex=0,cx.test(text)&&(text=text.replace(cx,function(e){return"\\u"+("0000"+e.charCodeAt(0).toString(16)).slice(-4)}));if(/^[\],:{}\s]*$/.test(text.replace(/\\(?:["\\\/bfnrt]|u[0-9a-fA-F]{4})/g,"@").replace(/"[^"\\\n\r]*"|true|false|null|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?/g,"]").replace(/(?:^|:|,)(?:\s*\[)+/g,"")))return j=eval("("+text+")"),typeof reviver=="function"?walk({"":j},""):j;throw new SyntaxError("JSON.parse")})}(),function(e){function s(){try{return r in e&&e[r]}catch(t){return!1}}var t={},n=e.document,r="localStorage",i;t.disabled=!1,t.set=function(e,t){},t.get=function(e){},t.remove=function(e){},t.clear=function(){},t.transact=function(e,n,r){var i=t.get(e);r==null&&(r=n,n=null),typeof i=="undefined"&&(i=n||{}),r(i),t.set(e,i)},t.getAll=function(){},t.forEach=function(){},t.serialize=function(e){return JSON.stringify(e)},t.deserialize=function(e){if(typeof e!="string")return undefined;try{return JSON.parse(e)}catch(t){return e||undefined}};if(s())i=e[r],t.set=function(e,n){return n===undefined?t.remove(e):(i.setItem(e,t.serialize(n)),n)},t.get=function(e){return t.deserialize(i.getItem(e))},t.remove=function(e){i.removeItem(e)},t.clear=function(){i.clear()},t.getAll=function(){var e={};return t.forEach(function(t,n){e[t]=n}),e},t.forEach=function(e){for(var n=0;n<i.length;n++){var r=i.key(n);e(r,t.get(r))}};else if(n.documentElement.addBehavior){var o,u;try{u=new ActiveXObject("htmlfile"),u.open(),u.write('<script>document.w=window</script><iframe src="/favicon.ico"></iframe>'),u.close(),o=u.w.frames[0].document,i=o.createElement("div")}catch(a){i=n.createElement("div"),o=n.body}function f(e){return function(){var n=Array.prototype.slice.call(arguments,0);n.unshift(i),o.appendChild(i),i.addBehavior("#default#userData"),i.load(r);var s=e.apply(t,n);return o.removeChild(i),s}}var l=new RegExp("[!\"#$%&'()*+,/\\\\:;<=>?@[\\]^`{|}~]","g");function c(e){return e.replace(l,"___")}t.set=f(function(e,n,i){return n=c(n),i===undefined?t.remove(n):(e.setAttribute(n,t.serialize(i)),e.save(r),i)}),t.get=f(function(e,n){return n=c(n),t.deserialize(e.getAttribute(n))}),t.remove=f(function(e,t){t=c(t),e.removeAttribute(t),e.save(r)}),t.clear=f(function(e){var t=e.XMLDocument.documentElement.attributes;e.load(r);for(var n=0,i;i=t[n];n++)e.removeAttribute(i.name);e.save(r)}),t.getAll=function(e){var n={};return t.forEach(function(e,t){n[e]=t}),n},t.forEach=f(function(e,n){var r=e.XMLDocument.documentElement.attributes;for(var i=0,s;s=r[i];++i)n(s.name,t.deserialize(e.getAttribute(s.name)))})}try{var h="__storejs__";t.set(h,h),t.get(h)!=h&&(t.disabled=!0),t.remove(h)}catch(a){t.disabled=!0}t.enabled=!t.disabled,typeof module!="undefined"&&module.exports?module.exports=t:typeof define=="function"&&define.amd?define('store',t):e.store=t}(this.window||global);
/*
* EASYDROPDOWN - A Drop-down Builder for Styleable Inputs and Menus
* Version: 2.1.3
* License: Creative Commons Attribution 3.0 Unported - CC BY 3.0
* http://creativecommons.org/licenses/by/3.0/
* This software may be used freely on commercial and non-commercial projects with attribution to the author/copyright holder.
* Author: Patrick Kunka
* Copyright 2013 Patrick Kunka, All Rights Reserved
*/


(function($){

	function EasyDropDown(){
		this.isField = true,
		this.down = false,
		this.inFocus = false,
		this.disabled = false,
		this.cutOff = false,
		this.hasLabel = false,
		this.keyboardMode = false,
		this.nativeTouch = true,
		this.wrapperClass = 'dropdown',
		this.onChange = null;
	};

	EasyDropDown.prototype = {
		constructor: EasyDropDown,
		instances: {},
		init: function(domNode, settings){
			var	self = this;

			$.extend(self, settings);
			self.$select = $(domNode);
			self.id = domNode.id;
			self.options = [];
			self.$options = self.$select.find('option');
			self.isTouch = 'ontouchend' in document;
			self.$select.removeClass(self.wrapperClass+' dropdown');
			if(self.$select.is(':disabled')){
				self.disabled = true;
			};
			if(self.$options.length){
				self.$options.each(function(i){
					var $option = $(this);
					if($option.is(':selected')){
						self.selected = {
							index: i,
							title: $option.text()
						}
						self.focusIndex = i;
					};
					if($option.hasClass('label') && i == 0){
						self.hasLabel = true;
						self.label = $option.text();
						$option.attr('value','');
					} else {
						self.options.push({
							domNode: $option[0],
							title: $option.text(),
							value: $option.val(),
							selected: $option.is(':selected')
						});
					};
				});
				if(!self.selected){
					self.selected = {
						index: 0,
						title: self.$options.eq(0).text()
					}
					self.focusIndex = 0;
				};
				self.render();
			};
		},

		render: function(){
			var	self = this,
				touchClass = self.isTouch && self.nativeTouch ? ' touch' : '',
				disabledClass = self.disabled ? ' disabled' : '';

			self.$container = self.$select.wrap('<div class="'+self.wrapperClass+touchClass+disabledClass+'"><span class="old"/></div>').parent().parent();
			self.$active = $('<span class="selected">'+self.selected.title+'</span>').appendTo(self.$container);
			self.$carat = $('<span class="carat"/>').appendTo(self.$container);
			self.$scrollWrapper = $('<div><ul/></div>').appendTo(self.$container);
			self.$dropDown = self.$scrollWrapper.find('ul');
			self.$form = self.$container.closest('form');
			$.each(self.options, function(){
				var	option = this,
					active = option.selected ? ' class="active"':'';
				self.$dropDown.append('<li'+active+'>'+option.title+'</li>');
			});
			self.$items = self.$dropDown.find('li');
			self.maxHeight = 0;
			if(self.cutOff && self.$items.length > self.cutOff)self.$container.addClass('scrollable');
			for(i = 0; i < self.$items.length; i++){
				var $item = self.$items.eq(i);
				self.maxHeight += $item.outerHeight();
				if(self.cutOff == i+1){
					break;
				};
			};

			if(self.isTouch && self.nativeTouch){
				self.bindTouchHandlers();
			} else {
				self.bindHandlers();
			};
		},

		bindTouchHandlers: function(){
			var	self = this;
			self.$container.on('click.easyDropDown',function(){
				self.$select.focus();
			});
			self.$select.on({
				change: function(){
					var	$selected = $(this).find('option:selected'),
						title = $selected.text(),
						value = $selected.val();

					self.$active.text(title);
					if(typeof self.onChange === 'function'){
						self.onChange.call(self.$select[0],{
							title: title,
							value: value
						});
					};
				},
				focus: function(){
					self.$container.addClass('focus');
				},
				blur: function(){
					self.$container.removeClass('focus');
				}
			});
		},

		bindHandlers: function(){
			var	self = this;
			self.query = '';
			self.$container.on({
				'click.easyDropDown': function(){
					if(!self.down && !self.disabled){
						self.open();
					} else {
						self.close();
					};
				},
				'mousemove.easyDropDown': function(){
					if(self.keyboardMode){
						self.keyboardMode = false;
					};
				}
			});

			$('body').on('click.easyDropDown.'+self.id,function(e){
				var $target = $(e.target),
					classNames = self.wrapperClass.split(' ').join('.');

				if(!$target.closest('.'+classNames).length && self.down){
					self.close();
				};
			});

			self.$items.on({
				'click.easyDropDown': function(){
					var index = $(this).index();
					self.select(index);
					self.$select.focus();
				},
				'mouseover.easyDropDown': function(){
					if(!self.keyboardMode){
						var $t = $(this);
						$t.addClass('focus').siblings().removeClass('focus');
						self.focusIndex = $t.index();
					};
				},
				'mouseout.easyDropDown': function(){
					if(!self.keyboardMode){
						$(this).removeClass('focus');
					};
				}
			});

			self.$select.on({
				'focus.easyDropDown': function(){
					self.$container.addClass('focus');
					self.inFocus = true;
				},
				'blur.easyDropDown': function(){
					self.$container.removeClass('focus');
					self.inFocus = false;
				},
				'keydown.easyDropDown': function(e){
					if(self.inFocus){
						self.keyboardMode = true;
						var key = e.keyCode;

						if(key == 38 || key == 40 || key == 32){
							e.preventDefault();
							if(key == 38){
								self.focusIndex--
								self.focusIndex = self.focusIndex < 0 ? self.$items.length - 1 : self.focusIndex;
							} else if(key == 40){
								self.focusIndex++
								self.focusIndex = self.focusIndex > self.$items.length - 1 ? 0 : self.focusIndex;
							};
							if(!self.down){
								self.open();
							};
							self.$items.removeClass('focus').eq(self.focusIndex).addClass('focus');
							if(self.cutOff){
								self.scrollToView();
							};
							self.query = '';
						};
						if(self.down){
							if(key == 9 || key == 27){
								self.close();
							} else if(key == 13){
								e.preventDefault();
								self.select(self.focusIndex);
								self.close();
								return false;
							} else if(key == 8){
								e.preventDefault();
								self.query = self.query.slice(0,-1);
								self.search();
								clearTimeout(self.resetQuery);
								return false;
							} else if(key != 38 && key != 40){
								var letter = String.fromCharCode(key);
								self.query += letter;
								self.search();
								clearTimeout(self.resetQuery);
							};
						};
					};
				},
				'keyup.easyDropDown': function(){
					self.resetQuery = setTimeout(function(){
						self.query = '';
					},1200);
				}
			});

			self.$dropDown.on('scroll.easyDropDown',function(e){
				if(self.$dropDown[0].scrollTop >= self.$dropDown[0].scrollHeight - self.maxHeight){
					self.$container.addClass('bottom');
				} else {
					self.$container.removeClass('bottom');
				};
			});

			if(self.$form.length){
				self.$form.on('reset.easyDropDown', function(){
					var active = self.hasLabel ? self.label : self.options[0].title;
					self.$active.text(active);
				});
			};
		},

		unbindHandlers: function(){
			var self = this;

			self.$container
				.add(self.$select)
				.add(self.$items)
				.add(self.$form)
				.add(self.$dropDown)
				.off('.easyDropDown');
			$('body').off('.'+self.id);
		},

		open: function(){
			var self = this,
				scrollTop = window.scrollY || document.documentElement.scrollTop,
				scrollLeft = window.scrollX || document.documentElement.scrollLeft,
				scrollOffset = self.notInViewport(scrollTop);

			self.closeAll();
			self.$select.focus();
			window.scrollTo(scrollLeft, scrollTop+scrollOffset);
			self.$container.addClass('open');
			self.$scrollWrapper.css('height',self.maxHeight+'px');
			self.down = true;
		},

		close: function(){
			var self = this;
			self.$container.removeClass('open');
			self.$scrollWrapper.css('height','0px');
			self.focusIndex = self.selected.index;
			self.query = '';
			self.down = false;
		},

		closeAll: function(){
			var self = this,
				instances = Object.getPrototypeOf(self).instances;
			for(var key in instances){
				var instance = instances[key];
				instance.close();
			};
		},

		select: function(index){
			var self = this;

			if(typeof index === 'string'){
				index = self.$select.find('option[value='+index+']').index() - 1;
			};

			var	option = self.options[index],
				selectIndex = self.hasLabel ? index + 1 : index;
			self.$items.removeClass('active').eq(index).addClass('active');
			self.$active.text(option.title);
			self.$select
				.find('option')
				.removeAttr('selected')
				.eq(selectIndex)
				.prop('selected',true)
				.parent()
				.trigger('change');

			self.selected = {
				index: index,
				title: option.title
			};
			self.focusIndex = i;
			if(typeof self.onChange === 'function'){
				self.onChange.call(self.$select[0],{
					title: option.title,
					value: option.value
				});
			};
		},

		search: function(){
			var self = this,
				lock = function(i){
					self.focusIndex = i;
					self.$items.removeClass('focus').eq(self.focusIndex).addClass('focus');
					self.scrollToView();
				},
				getTitle = function(i){
					return self.options[i].title.toUpperCase();
				};

			for(i = 0; i < self.options.length; i++){
				var title = getTitle(i);
				if(title.indexOf(self.query) == 0){
					lock(i);
					return;
				};
			};

			for(i = 0; i < self.options.length; i++){
				var title = getTitle(i);
				if(title.indexOf(self.query) > -1){
					lock(i);
					break;
				};
			};
		},

		scrollToView: function(){
			var self = this;
			if(self.focusIndex >= self.cutOff){
				var $focusItem = self.$items.eq(self.focusIndex),
					scroll = ($focusItem.outerHeight() * (self.focusIndex + 1)) - self.maxHeight;

				self.$dropDown.scrollTop(scroll);
			};
		},

		notInViewport: function(scrollTop){
			var self = this,
				range = {
					min: scrollTop,
					max: scrollTop + (window.innerHeight || document.documentElement.clientHeight)
				},
				menuBottom = self.$dropDown.offset().top + self.maxHeight;

			if(menuBottom >= range.min && menuBottom <= range.max){
				return 0;
			} else {
				return (menuBottom - range.max) + 5;
			};
		},

		destroy: function(){
			var self = this;
			self.unbindHandlers();
			self.$select.unwrap().siblings().remove();
			self.$select.unwrap();
			delete Object.getPrototypeOf(self).instances[self.$select[0].id];
		},

		disable: function(){
			var self = this;
			self.disabled = true;
			self.$container.addClass('disabled');
			self.$select.attr('disabled',true);
			if(!self.down)self.close();
		},

		enable: function(){
			var self = this;
			self.disabled = false;
			self.$container.removeClass('disabled');
			self.$select.attr('disabled',false);
		}
	};

	var instantiate = function(domNode, settings){
			domNode.id = !domNode.id ? 'EasyDropDown'+rand() : domNode.id;
			var instance = new EasyDropDown();
			if(!instance.instances[domNode.id]){
				instance.instances[domNode.id] = instance;
				instance.init(domNode, settings);
			};
		},
		rand = function(){
			return ('00000'+(Math.random()*16777216<<0).toString(16)).substr(-6).toUpperCase();
		};

	$.fn.easyDropDown = function(){
		var args = arguments,
			dataReturn = [],
			eachReturn;

		eachReturn = this.each(function(){
			if(args && typeof args[0] === 'string'){
				var data = EasyDropDown.prototype.instances[this.id][args[0]](args[1], args[2]);
				if(data)dataReturn.push(data);
			} else {
				instantiate(this, args[0]);
			};
		});

		if(dataReturn.length){
			return dataReturn.length > 1 ? dataReturn : dataReturn[0];
		} else {
			return eachReturn;
		};
	};

	$(function(){
		if(typeof Object.getPrototypeOf !== 'function'){
			if(typeof 'test'.__proto__ === 'object'){
				Object.getPrototypeOf = function(object){
					return object.__proto__;
				};
			} else {
				Object.getPrototypeOf = function(object){
					return object.constructor.prototype;
				};
			};
		};

		$('select.dropdown').each(function(){
			var json = $(this).attr('data-settings');
				settings = json ? $.parseJSON(json) : {};
			instantiate(this, settings);
		});
	});
})(jQuery);

define("easydropdown", function(){});
