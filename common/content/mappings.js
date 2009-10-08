// Copyright (c) 2006-2009 by Martin Stubenschrott <stubenschrott@vimperator.org>
//
// This work is licensed for reuse under an MIT license. Details are
// given in the LICENSE.txt file included with this file.


/** @scope modules */

/**
 * A class representing key mappings. Instances are created by the
 * {@link Mappings} class.
 *
 * @param {number[]} modes The modes in which this mapping is active.
 * @param {string[]} keys The key sequences which are bound to
 *     <b>action</b>.
 * @param {string} description A short one line description of the key mapping.
 * @param {function} action The action invoked by each key sequence.
 * @param {Object} extraInfo An optional extra configuration hash. The
 *     following properties are supported.
 *         arg     - see {@link Map#arg}
 *         count   - see {@link Map#count}
 *         motion  - see {@link Map#motion}
 *         route   - see {@link Map#route}
 *         noremap - see {@link Map#noremap}
 *         rhs     - see {@link Map#rhs}
 *         silent  - see {@link Map#silent}
 * @optional
 * @private
 */
function Map(modes, keys, description, action, extraInfo) //{{{
{
    modes = Array.concat(modes);

    if (!extraInfo)
        extraInfo = {};

    /** @property {number[]} All of the modes for which this mapping applies. */
    this.modes = modes;
    /** @property {string[]} All of this mapping's names (key sequences). */
    this.names = keys.map(events.canonicalKeys);
    /** @property {function (number)} The function called to execute this mapping. */
    this.action = action;
    /** @property {string} This mapping's description, as shown in :viusage. */
    this.description = description || "";

    /** @property {boolean} Whether this mapping accepts an argument. */
    this.arg = extraInfo.arg || false;
    /** @property {boolean} Whether this mapping accepts a count. */
    this.count = extraInfo.count || false;
    /**
     * @property {boolean} Whether the mapping accepts a motion mapping
     *     as an argument.
     */
    this.motion = extraInfo.motion || false;
    /**
     * @property {boolean} Whether the mapping's key events should be
     *     propagated to the host application.
     */
    // TODO: I'm not sure this is the best name but it reflects that which it replaced. --djk
    this.route = extraInfo.route || false;
    /** @property {boolean} Whether the RHS of the mapping should expand mappings recursively. */
    this.noremap = extraInfo.noremap || false;
    /** @property {boolean} Whether any output from the mapping should be echoed on the command line. */
    this.silent = extraInfo.silent || false;
    /** @property {string} The literal RHS expansion of this mapping. */
    this.rhs = extraInfo.rhs || null;
    /**
     * @property {boolean} Specifies whether this is a user mapping. User
     *     mappings may be created by plugins, or directly by users. Users and
     *     plugin authors should create only user mappings.
     */
    this.user = extraInfo.user || false;
}

Map.prototype = {

    /**
     * Returns whether this mapping can be invoked by a key sequence matching
     * <b>name</b>.
     *
     * @param {string} name The name to query.
     * @returns {boolean}
     */
    hasName: function (name) this.names.indexOf(name) >= 0,

    /**
     * Execute the action for this mapping.
     *
     * @param {string} motion The motion argument if accepted by this mapping.
     *     E.g. "w" for "dw"
     * @param {number} count The associated count. E.g. "5" for "5j"
     * @default -1
     * @param {string} argument The normal argument if accepted by this
     *     mapping. E.g. "a" for "ma"
     */
    execute: function (motion, count, argument)
    {
        let args = [];

        if (this.motion)
            args.push(motion);
        if (this.count)
            args.push(count);
        if (this.arg)
            args.push(argument);

        let self = this;
        // FIXME: Kludge.
        if (this.names[0] != ".")
            mappings.repeat = function () self.action.apply(self, args);

        return this.action.apply(this, args);
    }

}; //}}}

/**
 * @instance mappings
 */
function Mappings() //{{{
{
    ////////////////////////////////////////////////////////////////////////////////
    ////////////////////// PRIVATE SECTION /////////////////////////////////////////
    /////////////////////////////////////////////////////////////////////////////{{{

    var main = []; // default mappings
    var user = []; // user created mappings

    for (let mode in modes)
    {
        main[mode] = [];
        user[mode] = [];
    }

    function addMap(map)
    {
        let where = map.user ? user : main;
        map.modes.forEach(function (mode) {
            if (!(mode in where))
                where[mode] = [];
            where[mode].push(map);
        });
    }

    function getMap(mode, cmd, stack)
    {
        let maps = stack[mode] || [];

        for (let [, map] in Iterator(maps))
        {
            if (map.hasName(cmd))
                return map;
        }

        return null;
    }

    function removeMap(mode, cmd)
    {
        let maps = user[mode] || [];
        let names;

        for (let [i, map] in Iterator(maps))
        {
            for (let [j, name] in Iterator(map.names))
            {
                if (name == cmd)
                {
                    map.names.splice(j, 1);
                    if (map.names.length == 0)
                        maps.splice(i, 1);
                    return;
                }
            }
        }
    }

    function expandLeader(keyString) keyString.replace(/<Leader>/i, mappings.getMapLeader())

    // Return all mappings present in all @modes
    function mappingsIterator(modes, stack)
    {
        modes = modes.slice();
        return (map for ([i, map] in Iterator(stack[modes.shift()]))
            if (modes.every(function (mode) stack[mode].some(
                        function (m) m.rhs == map.rhs && m.names[0] == map.names[0]))))
    }

    function addMapCommands(ch, modes, modeDescription)
    {
        // 0 args -> list all maps
        // 1 arg  -> list the maps starting with args
        // 2 args -> map arg1 to arg*
        function map(args, modes, noremap)
        {
            if (!args.length)
            {
                mappings.list(modes);
                return;
            }

            let [lhs, rhs] = args;

            if (!rhs) // list the mapping
                mappings.list(modes, expandLeader(lhs));
            else
            {
                // this matches Vim's behaviour
                if (/^<Nop>$/i.test(rhs))
                    noremap = true;

                mappings.addUserMap(modes, [lhs],
                    "User defined mapping",
                    function (count) { events.feedkeys((count > -1 ? count : "") + this.rhs, this.noremap, this.silent); },
                    {
                        count: true,
                        rhs: events.canonicalKeys(rhs),
                        noremap: !!noremap,
                        silent: "<silent>" in args
                    });
            }
        }

        modeDescription = modeDescription ? " in " + modeDescription + " mode" : "";

        // :map, :noremap => NORMAL + VISUAL modes
        function isMultiMode(map, cmd)
        {
            return map.modes.indexOf(modules.modes.NORMAL) >= 0
                && map.modes.indexOf(modules.modes.VISUAL) >= 0
                && /^[nv](nore)?map$/.test(cmd);
        }

        const opts = {
                completer: function (context, args) completion.userMapping(context, args, modes),
                options: [
                    [["<silent>", "<Silent>"],  commands.OPTION_NOARG]
                ],
                literal: 1,
                serial: function ()
                {
                    let noremap = this.name.indexOf("noremap") > -1;
                    return [
                        {
                            command: this.name,
                            options: map.silent ? { "<silent>": null } : {},
                            arguments: [map.names[0]],
                            literalArg: map.rhs
                        }
                        for (map in mappingsIterator(modes, user))
                        if (map.rhs && map.noremap == noremap && !isMultiMode(map, this.name))
                    ];
                }
        };

        commands.add([ch ? ch + "m[ap]" : "map"],
            "Map a key sequence" + modeDescription,
            function (args) { map(args, modes, false); },
            opts);

        commands.add([ch + "no[remap]"],
            "Map a key sequence without remapping keys" + modeDescription,
            function (args) { map(args, modes, true); },
            opts);

        commands.add([ch + "mapc[lear]"],
            "Remove all mappings" + modeDescription,
            function () { modes.forEach(function (mode) { mappings.removeAll(mode); }); },
            { argCount: "0" });

        commands.add([ch + "unm[ap]"],
            "Remove a mapping" + modeDescription,
            function (args)
            {
                args = args[0];

                let found = false;
                for (let [, mode] in Iterator(modes))
                {
                    if (mappings.hasMap(mode, args))
                    {
                        mappings.remove(mode, args);
                        found = true;
                    }
                }
                if (!found)
                    liberator.echoerr("E31: No such mapping");
            },
            {
                argCount: "1",
                completer: function (context, args) completion.userMapping(context, args, modes)
            });
    }

    /////////////////////////////////////////////////////////////////////////////}}}
    ////////////////////// COMMANDS ////////////////////////////////////////////////
    /////////////////////////////////////////////////////////////////////////////{{{

    addMapCommands("",  [modes.NORMAL, modes.VISUAL], "");

    for (let mode in modes.mainModes)
        if (mode.char && !commands.get(mode.char + "map"))
            addMapCommands(mode.char,
                           [m.mask for (m in modes.mainModes) if (m.char == mode.char)],
                           [mode.disp.toLowerCase()]);

    /////////////////////////////////////////////////////////////////////////////}}}
    ////////////////////// COMPLETIONS /////////////////////////////////////////////
    /////////////////////////////////////////////////////////////////////////////{{{

    liberator.registerObserver("load_completion", function () {
        completion.setFunctionCompleter(mappings.get,
        [
            null,
            function (context, obj, args)
            {
                let mode = args[0];
                return util.Array.flatten(
                [
                    [[name, map.description] for ([i, name] in Iterator(map.names))]
                    for ([i, map] in Iterator(user[mode].concat(main[mode])))
                ]);
            }
        ]);

        completion.userMapping = function userMapping(context, args, modes) {
            // FIXME: have we decided on a 'standard' way to handle this clash? --djk
            modes = modes || [modules.modes.NORMAL];

            if (args.completeArg == 0)
            {
                let maps = [[m.names[0], ""] for (m in mappings.getUserIterator(modes))];
                context.completions = maps;
            }
        };
    });

    /////////////////////////////////////////////////////////////////////////////}}}
    ////////////////////// PUBLIC SECTION //////////////////////////////////////////
    /////////////////////////////////////////////////////////////////////////////{{{

    return {

        // NOTE: just normal mode for now
        /** @property {Iterator(Map)} @private */
        __iterator__: function () mappingsIterator([modes.NORMAL], main),

        // used by :mkvimperatorrc to save mappings
        /**
         * Returns a user-defined mappings iterator for the specified
         * <b>mode</b>.
         *
         * @param {number} mode The mode to return mappings from.
         * @returns {Iterator(Map)}
         */
        getUserIterator: function (mode) mappingsIterator(mode, user),

        addMode: function (mode)
        {
            if (!(mode in user || mode in main))
            {
                main[mode] = [];
                user[mode] = [];
            }
        },

        /**
         * Adds a new default key mapping.
         *
         * @param {number[]} modes The modes that this mapping applies to.
         * @param {string[]} keys The key sequences which are bound to
         *     <b>action</b>.
         * @param {string} description A description of the key mapping.
         * @param {function} action The action invoked by each key sequence.
         * @param {Object} extra An optional extra configuration hash.
         * @optional
         */
        add: function (modes, keys, description, action, extra)
        {
            addMap(new Map(modes, keys, description, action, extra));
        },

        /**
         * Adds a new user-defined key mapping.
         *
         * @param {number[]} modes The modes that this mapping applies to.
         * @param {string[]} keys The key sequences which are bound to
         *     <b>action</b>.
         * @param {string} description A description of the key mapping.
         * @param {function} action The action invoked by each key sequence.
         * @param {Object} extra An optional extra configuration hash (see
         *     {@link Map#extraInfo}).
         * @optional
         */
        addUserMap: function (modes, keys, description, action, extra)
        {
            keys = keys.map(expandLeader);
            extra = extra || {};
            extra.user = true;
            let map = new Map(modes, keys, description || "User defined mapping", action, extra);

            // remove all old mappings to this key sequence
            for (let [, name] in Iterator(map.names))
            {
                for (let [, mode] in Iterator(map.modes))
                    removeMap(mode, name);
            }

            addMap(map);
        },

        /**
         * Returns the map from <b>mode</b> named <b>cmd</b>.
         *
         * @param {number} mode The mode to search.
         * @param {string} cmd The map name to match.
         * @returns {Map}
         */
        get: function (mode, cmd)
        {
            mode = mode || modes.NORMAL;
            return getMap(mode, cmd, user) || getMap(mode, cmd, main);
        },

        /**
         * Returns the default map from <b>mode</b> named <b>cmd</b>.
         *
         * @param {number} mode The mode to search.
         * @param {string} cmd The map name to match.
         * @returns {Map}
         */
        getDefault: function (mode, cmd)
        {
            mode = mode || modes.NORMAL;
            return getMap(mode, cmd, main);
        },

        /**
         * Returns an array of maps with names starting with but not equal to
         * <b>prefix</b>.
         *
         * @param {number} mode The mode to search.
         * @param {string} prefix The map prefix string to match.
         * @returns {Map[]}
         */
        getCandidates: function (mode, prefix)
        {
            let mappings = user[mode].concat(main[mode]);
            let matches = [];

            for (let [, map] in Iterator(mappings))
            {
                for (let [, name] in Iterator(map.names))
                {
                    if (name.indexOf(prefix) == 0 && name.length > prefix.length)
                    {
                        // for < only return a candidate if it doesn't look like a <c-x> mapping
                        if (prefix != "<" || !/^<.+>/.test(name))
                            matches.push(map);
                    }
                }
            }

            return matches;
        },

        /*
         * Returns the map leader string used to replace the special token
         * "<Leader>" when user mappings are defined.
         *
         * @returns {string}
         */
        // FIXME: property
        getMapLeader: function ()
        {
            let leaderRef = liberator.variableReference("mapleader");
            return leaderRef[0] ? leaderRef[0][leaderRef[1]] : "\\";
        },

        /**
         * Returns whether there is a user-defined mapping <b>cmd</b> for the
         * specified <b>mode</b>.
         *
         * @param {number} mode The mode to search.
         * @param {string} cmd The candidate key mapping.
         * @returns {boolean}
         */
        hasMap: function (mode, cmd) user[mode].some(function (map) map.hasName(cmd)),

        /**
         * Remove the user-defined mapping named <b>cmd</b> for <b>mode</b>.
         *
         * @param {number} mode The mode to search.
         * @param {string} cmd The map name to match.
         */
        remove: function (mode, cmd)
        {
            removeMap(mode, cmd);
        },

        /**
         * Remove all user-defined mappings for <b>mode</b>.
         *
         * @param {number} mode The mode to remove all mappings from.
         */
        removeAll: function (mode)
        {
            user[mode] = [];
        },

        /**
         * Lists all user-defined mappings matching <b>filter</b> for the
         * specified <b>modes</b>.
         *
         * @param {number[]} modes An array of modes to search.
         * @param {string} filter The filter string to match.
         */
        list: function (modes, filter)
        {
            let modeSign = "";

            // TODO: Vim hides "nv" in a :map and "v" and "n" in :vmap and
            //       :nmap respectively if the map is not exclusive.
            modes.forEach(function (mode) {
                for (let m in modules.modes.mainModes)
                    if (mode == m.mask && modeSign.indexOf(m.char) == -1)
                        modeSign += m.char;
            });

            let maps = mappingsIterator(modes, user);
            if (filter)
                maps = [map for (map in maps) if (map.names[0] == filter)];

            let list = <table>
                    {
                        template.map(maps, function (map)
                            template.map(map.names, function (name)
                            <tr>
                                <td>{modeSign} {name}</td>
                                <td>{map.noremap ? "*" : " "}</td>
                                <td>{map.rhs || "function () { ... }"}</td>
                            </tr>))
                    }
                    </table>;

            // TODO: Move this to an ItemList to show this automatically
            if (list.*.length() == list.text().length())
            {
                liberator.echomsg("No mapping found");
                return;
            }
            commandline.echo(list, commandline.HL_NORMAL, commandline.FORCE_MULTILINE);
        }
    };
    //}}}
} //}}}

// vim: set fdm=marker sw=4 ts=4 et:
