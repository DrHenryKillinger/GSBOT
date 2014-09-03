/*
 *  The MIT License (MIT)
 *
 *  Copyright (c) 2014 Ulysse Manceron
 *
 *  Permission is hereby granted, free of charge, to any person obtaining a copy
 *  of this software and associated documentation files (the "Software"), to deal
 *  in the Software without restriction, including without limitation the rights
 *  to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 *  copies of the Software, and to permit persons to whom the Software is
 *  furnished to do so, subject to the following conditions:
 *
 *  The above copyright notice and this permission notice shall be included in all
 *  copies or substantial portions of the Software.
 *
 *  THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 *  IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 *  FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 *  AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 *  LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 *  OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 *  SOFTWARE.
 *
 */
var songleft;
var allSongsId = [];
var lastPlayedSongs = [];
var actionTable = {};
var lastPlay;
var forcePlay = false;
var playingRandom = false;
var followingList = [];
var adminActions = {};
var rng;
var coolDown= {};
var seenLast={};
var myID;

// GroovesharkUtils
var GU = {
/*  ##################
    Backend Functions
    ##################*/
    'addSongToHistory': function() {
        if (Grooveshark.getCurrentSongStatus().song == null)
            return;
        var currSongID = Grooveshark.getCurrentSongStatus().song.songID;
        if (lastPlayedSongs.length == 0 || lastPlayedSongs[lastPlayedSongs.length - 1] != currSongID) {
            var posToRemove = lastPlayedSongs.indexOf(currSongID);
            // Remove the song in the list
            if (posToRemove != -1)
                lastPlayedSongs.splice(posToRemove, 1);
            lastPlayedSongs.push(currSongID);
            // Remove the oldest song in the list if it goes over the limit.
            if (GUParams.historyLength < lastPlayedSongs.length)
                lastPlayedSongs.shift();
        }
    },
    'broadcast': function() {
        if (GS.getLoggedInUserID() <= 0)
            alert('Cannot login!');
        else {
            GU.updateFollowing();
            GS.Services.API.getUserLastBroadcast().then(function(bc) {
                GS.Services.SWF.ready.then(function() {
                    GS.Services.SWF.resumeBroadcast(bc.BroadcastID);
                    setTimeout(GU.startBroadcasting, 3000, bc);
                });
            });
        }
    },
    'callback': function() {
        if (songleft != GU.songInQueue()) {
            songleft = GU.songInQueue();
            if (songleft >= 2)
                playingRandom = false;
            GU.renameBroadcast();
        }
        GU.addSongToHistory();
        if (songleft < 1)
            GU.playRandomSong();
        GU.deletePlayedSong();
        GU.forcePlay();
        /*
            Idea for later:
            To remove this callback, we can extends GS.Services.SWF.queueChange.
        */
    },
    'deletePlayedSong': function() {
        var previousSong;
        while (true) {
            previousSong = GS.Services.SWF.getCurrentQueue().previousSong;
            if (previousSong != null)
                GS.Services.SWF.removeSongs([previousSong.queueSongID]);
            else
                break;
        }
    },
    'doParseMessage': function(current) {
        var string = current.data;
        var regexp = RegExp('^/([A-z0-9]*)([ ]+(.+))?$');
        var regResult = regexp.exec(string);
        if (regResult != null) {
            var indexFound = GU.findInArray(regResult[1],actionTable);
            var currentAction = actionTable[indexFound];
            if (currentAction instanceof Array && currentAction[0].every(function(element) {
                return element(current.userID);
            }))
                currentAction[1](current, regResult[3]);
            if (GU.guestOrWhite(current.userID)) {
                indexFound = GU.findInArray(regResult[1],adminActions);
                var currentAction = adminActions[indexFound];
                if (currentAction instanceof Array && currentAction[0].every(function(element) {
                    return element(current.userID);
                }))
                    currentAction[1](current, regResult[3]);
            }
        }
    },
    'findInArray': function(searchTerm, arrayName) { //case insensitive find in arrays
        for (var key in arrayName){
            if (arrayName.hasOwnProperty(key)){
                var keyLower = key.toLowerCase();
                var searchLower = searchTerm.toLowerCase();
                if (searchLower == keyLower){
                    return key;
                }
            }
        }
        return 'error';
    },
    'followerCheck': function(userid) {
        return followingList.indexOf(userid) != -1;
    },
    'forcePlay': function() {
        if (Grooveshark.getCurrentSongStatus().status != 'playing') {
            if (new Date() - lastPlay > 4000 && !forcePlay) {
                forcePlay = true;
                Grooveshark.play();
            }
            if (new Date() - lastPlay > 8000) {
                Grooveshark.removeCurrentSongFromQueue();
                forcePlay = false;
                lastPlay = new Date();
            }
        } else {
            forcePlay = false;
            lastPlay = new Date();
        }
    },
    'getMatchedSongsList': function(stringFilter) {
        var regex = RegExp(stringFilter, 'i');
        var songs = GU.getPlaylistNextSongs();
        var listToRemove = [];
        songs.forEach(function(element) {
            if (regex.test(element.AlbumName) ||
                // regex.test(element.ArtistName) ||
                regex.test(element.SongName))
                listToRemove.push(element);
        });
        return listToRemove;
    },
    'getPlaylistNextSongs': function() {
        var songs = GS.Services.SWF.getCurrentQueue().songs;
        var index = GS.Services.SWF.getCurrentQueue().activeSong.queueSongID;
        songs.shift(); //skip the first song (currently playing song)
        return songs;
    },

    'getUserName': function(uID) {
        var uName = '';
        GS.Models.User.get(uID).then(function(u){
            uName = u.get('Name');
        })
        return uName;
    },
    'guestCheck': function(userid) {
        if (!GU.isGuesting(userid)) {
            GU.sendMsg('Only Guests can use that feature, sorry!');
            return false;
        }
        return true;
    },
    'guestOrWhite': function(userid) {
        return (GU.isGuesting(userid) || GU.whiteListCheck(userid));
    },
    'inBroadcast': function() {
        return $('#bc-take-over-btn').hasClass('hide');
    },
    'inListCheck': function(userid, list) {
        return list.split(',').indexOf("" + userid) != -1;
    },
    'isGuesting': function(userid) {
        return GS.getCurrentBroadcast().attributes.vipUsers.some(function(elem) {
            return elem.userID == userid;
        });
    },
    'isListening': function(user){
        if (isNaN(user)) {
            return GS.getCurrentBroadcast().attributes.listeners.models.some(function(elem) {
                return elem.attributes.Name == user;
            });
        } else {
            return GS.getCurrentBroadcast().attributes.listeners.models.some(function(elem) {
                return elem.attributes.UserID == user;
            });
        }
    },
    'monthNumber': function(e) {var t=parseInt(e);var n;switch(t){case 0:n="Jan.";break;case 1:n="Feb.";break;case 2:n="Mar.";break;case 3:n="Apr.";break;case 4:n="May";break;case 5:n="Jun.";break;case 6:n="Jul.";break;case 7:n="Aug.";break;case 8:n="Sep.";break;case 9:n="Oct.";break;case 10:n="Nov.";break;case 11:n="Dec.";break}return n},
    'openSidePanel': function() {
        if ($('.icon-sidebar-open-m-gray')[0])
            $('.icon-sidebar-open-m-gray').click()
    },
    'ownerCheck': function(userid) {
        if (userid != GS.getCurrentBroadcast().attributes.UserID) {
            GU.sendMsg('Only the Master can use that feature, sorry!');
            return false;
        }
        return true;
    },
    'playRandomSong': function()  {
        playingRandom = true;
        GU.RandomOrg(0,allSongsId.length)
        var nextSong = allSongsId[rng];
        if (nextSong != undefined) {
            var nextSongIndex = lastPlayedSongs.indexOf(nextSong);
            var maxTry = 5;
            while (nextSongIndex != -1 && maxTry-- > 0) {
                GU.RandomOrg(0,allSongsId.length)
                var tmpSong = allSongsId[rng];
                if (tmpSong != undefined) {
                    var tmpIndex = lastPlayedSongs.indexOf(tmpSong);
                    if (tmpIndex < nextSongIndex)
                        nextSong = tmpSong;
                }
            }
            Grooveshark.addSongsByID([nextSong]);
        }
    },
    'RandomOrg': function(min, max) {
        rng = undefined;
        $(function(){
            $.ajax({
                async: false,
                url: 'http://www.random.org/integers/?num=1&min=' + min + '&max=' + max + '&col=1&base=10&format=plain&rnd=new',
            })
            .done(function(data){
                var rand = data.split('\n');
                rng = rand[0];
            });
        });
        //Fallback RNG incase random.org has a problem
            if (rng == undefined){
            var randArraySize = Math.floor(Math.random() * 100); //create an array of up to 100 elements
            var randArray = []
            for (counter = 0; counter < randArraySize; counter++) { //populate array with random numbers
                randArray[counter] = Math.floor((Math.random() * max) + min);
            }
            rng = randArray[Math.floor(Math.random() * randArray.length)] //randomly choose an array element to use as random number
        }
    },
    'removeMsg': function() {
        $('.chat-message').addClass('parsed');
    },
    'renameBroadcast': function(bdcName) {
        var attributes = GS.getCurrentBroadcast().attributes;
        if (attributes == undefined)
            return;
        var maxDescriptionLength = 145;

        var defName = attributes.Description;
        defName = defName.substr(0, defName.indexOf(GUParams.prefixRename)) + GUParams.prefixRename + ' [EGSA-tan] ';
        if (playingRandom) {
            defName += 'Playing from collection';
        } else {
            defName += GU.songInQueue() + ' song' + (GU.songInQueue() != 1 ? 's' : '') + ' left';
        }
        if (bdcName == null)
            bdcName = defName;
        GS.Services.SWF.changeBroadcastInfo(GS.getCurrentBroadcastID(), {
            'Description': bdcName.substr(0, maxDescriptionLength)
        });
    },
    'seenLog': function(t) {
        if (t.userID != myID) {
            var uID = t.userID;
            var uName = GU.getUserName(uID);
            var d = new Date();
            var GMT = d.toJSON(); //d.toUTCString();
            //action 0=LeftBC 1=JoinedBC 2=Chat
            var action = 2;
            if (t.joined != undefined) {
                action = t.joined;
            }
            if (Object.keys(seenLast).length !== 0) {
                for (var k in seenLast) {
                    if (seenLast[k][0] == uID) {
                        seenLast[k][1] = uName;
                        seenLast[k][2] = action;
                        seenLast[k][3] = GMT;
                        d = 1;
                        break;
                    } else {
                        d = 0;
                    }
                }
            } else {
                d = 0;
            }
            if (d === 0) {
                seenLast[Object.keys(seenLast).length] = [uID, uName, action, GMT];
            }
        }
    },
    'sendMsg': function(msg) {
        var broadcast = GS.getCurrentBroadcast();
        if (broadcast === false)
            return;

        var maxMsgLength = 256; // the max number of caracters that can go in the gs chat
        var index = 0;

        while ((Math.floor(msg.length / maxMsgLength) + (msg.length % maxMsgLength != 0)) >= ++index) {
            broadcast.sendChatMessage(msg.substr((index - 1) * maxMsgLength, maxMsgLength));
        }
    },
    'songInQueue': function() {
        return $('#queue-num-total').text() - $('#queue-num').text();
    },
    'startBroadcasting': function(bc) {
        var properties = {
            'Description': bc.Description,
            'Name': bc.Name,
            'Tag': bc.Tag
        };
        myID = bc.UserID;
        if (GS.getCurrentBroadcast() === false) {
            GS.Services.SWF.startBroadcast(properties);
            setTimeout(GU.startBroadcasting, 3000, bc);
            return;
        }
        GU.renameBroadcast();
        setTimeout(function() {
            GU.sendMsg(GUParams.welcomeMessage);
        }, 1000);
        Grooveshark.setVolume(0); //mute the broadcast.
        // Remove all the messages in chat
        GU.removeMsg();
        GU.openSidePanel();
        GS.Services.API.userGetSongIDsInLibrary().then(function(result) {
            allSongsId = result.SongIDs;
        });
        if ($('#lightbox-close').length == 1) {
            $('#lightbox-close').click();
        }
        lastPlay = new Date();
        // Check if there are msg in the chat, and process them.
        setInterval(GU.callback, 1000);

        // Overload handlechat
        var handleBroadcastSaved = GS.Services.SWF.handleBroadcastChat;
        GS.Services.SWF.handleBroadcastChat = function(e, t) {
            handleBroadcastSaved(e, t);
            GU.seenLog(t);
            GU.doParseMessage(t);
        };
        //Overload Join/Leave events
        GS.Services.SWF.handleBroadcastListenerJoined = function(e, t){
            GU.seenLog(t);
        };

    },
    'strictWhiteListCheck': function(userid) {
        if (GU.inListCheck(userid, GUParams.whitelist))
            return true;
        GU.sendMsg('Only user that are explicitly in the whitelist can use this feature, sorry!');
        return false;
    },
    'Timestamp': function(cmd, usr, waitTime) { //return TRUE if on cooldown, FALSE if not
        cmd = cmd.substring(1, cmd.length);
        cmd = cmd.split(' ');
        cmd = cmd[0];
        waitTime = waitTime * 1000;
        var tNow = Date.now();
        var tLog = 0;
        var inLog = 0;
        if (Object.keys(coolDown).length != 0) {
            for (var k in coolDown) {
                if (coolDown[k][0] == cmd) {
                    if (coolDown[k][1] == usr) {
                        tLog = coolDown[k][2];
                        var cdOver = parseInt(tLog);
                        cdOver += waitTime
                        inLog = 1;
                        if (tNow < cdOver) {
                            return true;
                        } else {
                            delete coolDown[k];
                            return false;
                        }
                    } else {
                        inLog = 0;
                    }
                } else {
                    inLog = 0;
                }
            }
        } else {
            coolDown[0] = [cmd, usr, Date.now()];
            return false;
        }
        if (inLog == 0) {
            coolDown[Object.keys(coolDown).length] = [cmd, usr, Date.now()];
            return false;
        }
    },
    'updateFollowing': function() {
        GS.Services.API.userGetFollowersFollowing().then(
            function(alluser) {
                followingList = [];
                alluser.forEach(function(single) {
                    if (single.IsFavorite === '1') {
                        followingList.push(parseInt(single.UserID));
                    }
                });
            });
    },
    'whiteListCheck': function(userid) {
        if (GU.inListCheck(userid, GUParams.whitelist)) // user in whitelist
        {
            return true;
        } else if (GUParams.whitelistIncludesFollowing.toString() === 'true' && !GU.inListCheck(userid, GUParams.blacklist) && GU.followerCheck(userid)) {
            return true;
        }
        return false;
    },

/*  #####################
    Chat Window Commands
    #####################*/
    'about': function() {
        GU.sendMsg('This broadcast is currently running "EGSA Broadcast Bot" v' + GUParams.version + ', created by grooveshark.com/karb0n13 . GitHub: http://goo.gl/UPGkO5 Forked From: http://goo.gl/vWM41J');
    },
    'addToCollection': function() {
        Grooveshark.addCurrentSongToLibrary();
        GU.sendMsg('Song added to the favorite.');
    },
    'ask': function(current, parameter) {
        var uName = GU.getUserName(current.userID);
        var onCooldown = GU.Timestamp(current.data,current.userID,20)
        if (onCooldown == true){ return; }
        if (parameter == undefined){
            return;
        }
        var textHTTP;
        var textFile = '/data/ask.txt';
        textHTTP = new XMLHttpRequest();
        textHTTP.onreadystatechange = function() {
            if (textHTTP.readyState == 4 && textHTTP.status == 200) {
                var fileContentLines = textHTTP.responseText.split('\n');
                GU.RandomOrg(0, fileContentLines.length);
                var randomLineIndex = rng;
                var randomLine = '@' + uName + ", ";
                randomLine = randomLine + fileContentLines[randomLineIndex];
                GU.sendMsg(randomLine);
            }
        }
        textHTTP.open('GET', 'chrome-extension://' + GUParams.extensionId + textFile, true);
        textHTTP.send();
    },
    'fact': function(current) {
        var onCooldown = GU.Timestamp(current.data,current.userID,30)
        if (onCooldown == true){ return; }
        var textHTTP;
        var textFile = '/data/facts.txt';
        textHTTP = new XMLHttpRequest();
        textHTTP.onreadystatechange=function(){
            if (textHTTP.readyState==4 && textHTTP.status==200){
                var fileContentLines = textHTTP.responseText.split('\n');
                    GU.RandomOrg(1,fileContentLines.length + 1);
                    var randomLineIndex = rng;
                    var randomLine = 'FACT #'+ Math.floor(Math.random() * 10000) + ': '
                    randomLine = randomLine + fileContentLines[randomLineIndex];
                    GU.sendMsg(randomLine);
            }
        }
        textHTTP.open('GET', 'chrome-extension://' + GUParams.extensionId + textFile, true);
        textHTTP.send();
    },
    'fetchByName': function(message, stringFilter) {
        var songToPlay = GU.getMatchedSongsList(stringFilter);
        if (songToPlay.length > 0) {
            GS.Services.SWF.moveSongsTo([songToPlay[0].queueSongID], 1, true);
            var sName = songToPlay[0].SongName;
            GU.sendMsg("Fetched \"" + sName +"\".");
        } else {
            GU.sendMsg("Unable to find song title matching: \"" + stringFilter + "\".");
        }
    },
    'fetchLast': function(message, parameter) { //@author: Flumble
        var count = 1;
        var queue = GS.Services.SWF.getCurrentQueue();
        var nextIndex = queue.activeSong.index + 1;

        if (parameter && parseInt(parameter) > 0)
            count = parseInt(parameter);

        if (nextIndex < queue.songs.length - count) {
            var lastSongs = queue.songs.slice(-count);
            lastSongs = lastSongs.map(function(song) {
                return song.queueSongID;
            }); //'of course' GS wants the queueID instead of a reference

            GS.Services.SWF.moveSongsTo(lastSongs, nextIndex, true);
            GU.sendMsg(count.toString() + " song" + ((count > 1) ? "s" : "") + " fetched");
        } else {
            //notify the broadcaster that too many songs were selected to play next
            if (nextIndex == queue.songs.length - count)
                GU.sendMsg((count == 1) ? "That IS the next song, silly" : "Those ARE the next songs, silly");
            else
                GU.sendMsg("Too many songs selected");
        }
    },
    'getPlaylist': function(message, parameter) {
        var playlistID = parameter;
        var playlistName = "";
        var playlistUser = "";
        var playlistUserId = "";
        var playlistCount = "";
        var msgUpdate = "";
        GS.Models.Playlist.get(playlistID).then(function(p) {
                //not run if does not exist
                playlistName = p.get('PlaylistName');
                playlistCount = p.get('SongCount');
                playlistUser = p.get('UserName');
                playlistUserId = p.get('UserID');
                msgUpdate = "Playlist: \"" + playlistName + "\" By: \"" + playlistUser + "\", " + playlistCount + " songs added."
                Grooveshark.addPlaylistByID(playlistID);
            }, // if it fails...
            function() {
                msgUpdate = "Unable to find a playlist with ID: \"" + playlistID + "\"."
            })
            .always(function() {
                GU.sendMsg(msgUpdate)
            });
    },
    'guest': function(current, parameter) {
        var userID = current.userID;
        if ((parameter != undefined) && !isNaN(parameter)) {
            userID = Number(parameter);
        }
        if (GS.getCurrentBroadcast().getPermissionsForUserID(userID) != undefined) { // is guest
            GS.Services.SWF.broadcastRemoveVIPUser(userID);
        } else {
            GS.Services.SWF.broadcastAddVIPUser(userID, 0, 63); // 63 seems to be the permission mask
        }
    },
    'help': function(current, parameter) {
        var onCooldown = GU.Timestamp(current.data, current.userID,30)
        if (onCooldown == true) {
            return;
        }
        if (parameter != undefined) { //get detailed help
            var indexFound = GU.findInArray(parameter, actionTable);
            var currentAction = actionTable[indexFound];
            if (currentAction instanceof Array) {
                GU.sendMsg('Help: /' + parameter + ' ' + currentAction[2]);
                return;
            }
        }
        var helpMsg = 'Command available:';
        Object.keys(actionTable).forEach(function(actionName) {
            helpMsg = helpMsg + ' ' + actionName;
        });
        if (helpMsg != 'Command available:') {
            helpMsg = helpMsg + '. Type /help [command name] for in depth help.';
            GU.sendMsg(helpMsg);
        }

        //if user is a guest then show these:
        var isAdmin = GU.guestOrWhite(current.userID);
        if (isAdmin) {
            helpMsg = 'Admin commands:'
            if (parameter != undefined) { //get detailed help
                var indexFound = GU.findInArray(parameter, adminActions);
                var currentAction = adminActions[indexFound];
                if (currentAction instanceof Array) {
                    GU.sendMsg('Help: /' + parameter + ' ' + currentAction[2]);
                    return;
                }
            }
            Object.keys(adminActions).forEach(function(actionName) {
                helpMsg = helpMsg + ' ' + actionName;
            });
            GU.sendMsg(helpMsg);
        }
    },
    'ping': function(current) {
        GU.sendMsg('Pong!');
    },
    'playPlaylist': function(message, playlistId) {
        GU.openSidePanel();
        var playlistToPlay = $('#sidebar-playlists-grid').find('.sidebar-playlist')[playlistId];
        if (playlistToPlay == null) {
            GU.sendMsg('Cannot find playlist: ' + playlistId);
        } else {
            var playlistId = $(playlistToPlay).children(0).attr('data-playlist-id');
            Grooveshark.addPlaylistByID(playlistId);
            GU.sendMsg('Playlist \'' + $(playlistToPlay).find('.name').text() + '\' added to the queue.');
        }
    },
    'previewRemoveByName': function(message, stringFilter) {
        var listToRemove = GU.getMatchedSongsList(stringFilter);
        if (listToRemove.length > 10 || listToRemove.length == 0)
            GU.sendMsg('' + listToRemove.length + 'Songs matched.');
        else {
            var string = 'Song matched: ';
            listToRemove.forEach(function(element) {
                string = string + element.SongName + ' ~ From: ' + element.AlbumName + GUParams.separator;
            });
            GU.sendMsg(string.substring(0, string.length - GUParams.separator.length));
        }
    },
    'previewSongs': function(msg, parameter) {
        var onCooldown = GU.Timestamp(msg.data, msg.userID,30)
        if (onCooldown == true) {
            return;
        }
        var nbr = parseInt(parameter);
        if (nbr <= 0 || isNaN(nbr))
            nbr = GUParams.defaultSongPreview;
        if (nbr > GUParams.maxSongPreview)
            nbr = GUParams.maxSongPreview;
        songs = GU.getPlaylistNextSongs();

        var i = -1;
        var string = '';
        nbr = nbr - 1;
        while (++i <= nbr) {
            var curr = songs[i];
            var sNum = i + 1;
            if (curr == null)
                break;
            string = string + '#' + sNum + ': \"' + curr.SongName + '\"" By: \"' + curr.ArtistName + "\"" + GUParams.separator;
        }
        if (string != '') {
            GU.sendMsg('Next songs are: ' + string.substring(0, string.length - GUParams.separator.length));
        } else {
            GU.sendMsg('You don\'t get to see the next songs :P');
        }
    },
    'removeByName': function(message, stringFilter) {
        //adding safeguard so that '/removeByName allSongs' must be typed to clear the queue.
        if (stringFilter == undefined) {
            GU.sendMsg("No songs were removed. Use \"/removeByName allSongs \" to clear the queue.");
            return;
        }
        if (stringFilter == "allSongs") {
            stringFilter = "";
        }
        var listToRemove = GU.getMatchedSongsList(stringFilter);
        var idToRemove = [];
        listToRemove.forEach(function(element) {
            idToRemove.push(element.queueSongID);
        });
        GS.Services.SWF.removeSongs(idToRemove);
        GU.sendMsg('Removed ' + idToRemove.length + ' songs.');
    },
    'removeFromCollection': function() {
        var currSong = Grooveshark.getCurrentSongStatus().song
        GS.Services.API.userRemoveSongsFromLibrary(GS.getLoggedInUserID(), currSong.songID, currSong.albumID, currSong.artistID).then(function() {
            GU.sendMsg('Song removed from the favorite.');
        });
    },
    'removeLastSong': function(message, numberStr) {
        var songs = GS.Services.SWF.getCurrentQueue().songs;
        var allID = [];
        var number = Math.floor(Number(numberStr));
        if (isNaN(number) || number < 1)
            number = 1;
        while (--number >= 0) {
            if (songs.length - 1 - number >= 0) {
                var id = songs[songs.length - 1 - number].queueSongID;
                if (id != GS.Services.SWF.getCurrentQueue().activeSong.queueSongID)
                    allID.push(id);
            }
        }
        if (allID.length > 0) {
            GS.Services.SWF.removeSongs(allID);
        }
    },
    'removeNextSong': function() {
        var nextSong = GS.Services.SWF.getCurrentQueue().nextSong;
        if (nextSong != null) {
            GS.Services.SWF.removeSongs([nextSong.queueSongID]);
        }
    },
    'roll': function(current, parameter) {
        var uName = "";
        var uID = current.userID;
        var onCooldown = GU.Timestamp(current.data, current.userID,15)
        if (onCooldown == true) {
            return;
        }
        GS.Models.User.get(uID).then(function(u) {
            uName = u.get('Name');
        })
        var min = 1;
        var max = 100;
        if (parameter == undefined) {
            // If no parameter is given, roll from 1 to 100
            parameter = "100";
        }
        if (/[a-z]/i.test(parameter)) {
            if (parameter.toLowerCase() == 'rick'){
                GU.sendMsg('┐(・。・┐)♪ Never gonna give you up. Never gonna let you down. Never gonna run around and desert you... ♪ ¬_¬');
                return;
            }
            var regexp = RegExp('([0-9]+)[d]([0-9]+)','ig');
            var dndDice = regexp.exec(parameter);
            if (dndDice != null){
                var q = parseInt(dndDice[1]);
                var s = parseInt(dndDice[2]);
                if (q == 0) {
                    GU.sendMsg('Okay... I summoned 0, ' + s + '-sided dice. It adds up to... 0...')
                    return;
                }
                if (s == 1) {
                    GU.sendMsg('You want to roll ' + q + ', 1-sided dice? What do you think you\'ll get? A freaking cookie?! NO! You get ' + q + '!');
                    return;
                }
                if (s == 0) {
                    GU.sendMsg('No, I\'m not going to roll any 0-sided dice, and you can\'t make me! :P');
                    return;
                }
                if ((q > 20) || ((q * s) > 10001)){
                    GU.sendMsg('Sorry, that\'s too much. Try rolling fewer or smaller dice.');
                    return;
                }
                var value = 0;
                for (i=0; i < q; i++){
                    GU.RandomOrg(1,s);
                    value = value + parseInt(rng);
                }
                GU.sendMsg('[Roll: ' + parameter.toLowerCase() + '] EGSA-tan summons ' + q + ', ' + s + ' sided dice.');
                GU.sendMsg(uName + ' rolls them and the dice add up to ' + value + '!');
                return;
            }
            GU.sendMsg("How do you expect me to roll " + parameter + "?");
            return;
        } else {
            max = parseInt(parameter);
            if (max > 2 && max < 10001) {
                GU.RandomOrg(min, max);
                var roll = rng;
                GU.sendMsg("[Roll: " + min + " - " + max + " ] EGSA-tan summons a magical dice. " + uName + " throws it and gets a " + roll + (roll > 9000 ? ". It's over 9000!" : "."));
            } else {
                // 0 or negative number
                if (max <= 0) {
                    GU.sendMsg("I am sorry, but it is impossible to create an object with fewer than 2 sides.");
                }
                // 1 gets a message ...
                if (max == 1) {
                    GU.sendMsg("A one sided dice? Really? ok....");
                    GU.sendMsg("[Roll] " + uName + " rolled a 1.. are you happy now?");
                }
                // For 2 sides we use a coin
                if (max == 2) {
                    GU.RandomOrg(min, max);
                    var flip = rng;
                    var coin = "";
                    if (flip == 1){
                        coin = "Heads";
                    } else if(flip == 2){
                        coin = "Tails";
                    }
                    if (!(coin == "Heads" || coin == "Tails")) {
                        GU.sendMsg("[Roll] EGSA-tan flips a coin. The coin lands on it's side!");
                    } else {
                        GU.sendMsg("[Roll] EGSA-tan flips a coin. The coin lands on " + coin + "!");
                    }
                }
                // Avoid using big number, because it gets out of the chat window
                if (max >= 10001) {
                    GU.sendMsg("I am sorry, I don't have enough power to summon a " + max + " sided dice.");
                }
            }
        }
    },
    'rules': function(current) {
        var onCooldown = GU.Timestamp(current.data,current.userID,30);
        if (onCooldown == true){ return; }
        var ruleslist = GUParams.rules.split(',');
        var msgDelay = 0;
        var loopTick = 0;
        var msg = "";
        for (i = 0; i < ruleslist.length; i++) {
            if (ruleslist[i] != "") {
                msg = ruleslist[i];
                msgDelay = loopTick * 1000;
                setTimeout(GU.sendMsg, msgDelay, msg);
                loopTick = loopTick + 1;
            }
        }
    },
    'seen': function(current, parameter) {
        var onCooldown;
        var sL;
        var uName;
        var uAction;
        var sMsg;
        if (parameter.length < 3) {
            onCooldown = GU.Timestamp(current.data, current.userID, 5);
            if (onCooldown) {
                return;
            }
            sMsg = 'I need at least 3 letters of the person\'s name to find them.'
            GU.sendMsg(sMsg);
            return;
        }
        onCooldown = GU.Timestamp(current.data, current.userID, 15);
        if (onCooldown) {
            return;
        }
        if (Object.keys(seenLast)) {
            for (var k in seenLast) {
                if ((!isNaN(parameter)) && (parameter.length > 5)) {
                    if (seenLast[k][0] == parameter) {
                        sL = k;
                        break;
                    }
                } else {
                    if (sSearch(k, parameter)) {
                        sL = k;
                        break;
                    }
                }

            }
        }
        if (sL != undefined) {
            if (seenLast[sL][0] == current.userID) {
                sMsg = "You are asking about yourself? Stop asking me to do stupid things.";
            } else {
                switch (seenLast[sL][2]) {
                    case 0:
                        uAction = 'leave the broadcast';
                        break;
                    case 1:
                        uAction = 'join the broadcast';
                        break;
                    case 2:
                        uAction = 'say something';
                        break;
                }
                var oDate = new Date(seenLast[sL][3]);
                var nDate = new Date();
                var diffDate = Math.abs(nDate - oDate);
                var elapsedD = parseInt(diffDate / (1000 * 60 * 60 * 24));
                var dbl = oDate.getUTCHours();
                if (dbl < 10) {
                    dbl = '0' + dbl;
                }
                var sTime = dbl + ':';
                dbl = oDate.getUTCMinutes();
                if (dbl < 10) {
                    dbl = '0' + dbl;
                }
                sTime = sTime + dbl + ':';
                dbl = oDate.getUTCSeconds();
                if (dbl < 10) {
                    dbl = '0' + dbl;
                }
                sTime = sTime + dbl + ' GMT';
                sMsg = 'I saw ' + seenLast[sL][1] + ' ' + uAction + ' ';
                if (elapsedD == 0) {
                    var elapsedH = parseInt((diffDate / (1000 * 60 * 60)) % 24);
                    var elapsedM = parseInt((diffDate / (1000 * 60)) % 60);
                    var elapsedS = parseInt((diffDate / 1000) % 60);
                    if (elapsedH != 0) {
                        sMsg = sMsg + elapsedH + 'h ' + elapsedM + 'm ago,';
                    }
                    if ((elapsedH == 0) && (elapsedM != 0)) {
                        sMsg = sMsg + elapsedM + 'm ' + elapsedS + 's ago,';
                    }
                    if ((elapsedH == 0) && (elapsedM == 0)) {
                        sMsg = sMsg + elapsedS + 's ago,';
                    }
                } else {
                    var month = GU.monthNumber(oDate.getUTCMonth());
                    sMsg = 'on ' + month + ' ' + oDate.getUTCDate();
                }
                sMsg = sMsg + ' at ' + sTime + '.';
            }
        } else {
            sMsg = 'I\'m sorry. I couldn\'t find anyone with \"' + parameter + '\" in their name.';
        }
        GU.sendMsg(sMsg);

        function sSearch(index, partial) {
            var userName = seenLast[index][1].toLowerCase()
            if (userName.indexOf(partial.toLowerCase()) > -1) {
                return true;
            } else {
                return false;
            }
        }
    },
    'showPlaylist': function(message, stringFilter) {
        GU.openSidePanel();
        var string = '';
        var regex = RegExp(stringFilter, 'i');
        $('#sidebar-playlists-grid').find('.sidebar-playlist').each(function() {
            var playlistName = $(this).find('.name').text();
            if (regex.test(playlistName))
                string = string + '#' + $(this).index() + ': ' + playlistName + GUParams.separator;
        });
        if (string == '')
            string = 'No match found for ' + stringFilter;
        else
            string = 'Playlist matched:' + string.substring(0, string.length - GUParams.separator.length);
        GU.sendMsg(string);
    },
    'shuffle': function(current, parameter) {
        var r = 1;
        if (parameter != undefined) {
            if (!isNaN(parameter)) {
                r = parseInt(parameter);
                if (r > 3) { r = 3 }
            }
        }
        for (i = 0; i < r; i++) {
            $('.shuffle').click();
        }        
        GU.sendMsg('The queue has been shuffled!');
    },
    'skip': function() {
        Grooveshark.removeCurrentSongFromQueue();
    },
    'whoamI': function(current){
        var onCooldown = GU.Timestamp(current.data,current.userID,30)
        if (onCooldown == true){ return; }
        var uName = GU.getUserName(current.userID);
        GU.sendMsg('You are:' + uName + '. Your ID is: ' + current.userID + '.');
    }
};
adminActions = {
    'guest': [
        [GU.inBroadcast, GU.guestOrWhite], GU.guest, 'USERID (optional)- Toogle guest status.'
    ],
    'addToCollection': [
        [GU.inBroadcast, GU.strictWhiteListCheck], GU.addToCollection, '- Add this song to the collection.'
    ],
    'removeFromCollection': [
        [GU.inBroadcast, GU.strictWhiteListCheck], GU.removeFromCollection, '- Remove this song from the collection.'
    ],
    'removeNext': [
    [GU.inBroadcast, GU.guestCheck], GU.removeNextSong, '- Remove the next song in the queue.'
    ],
    'removeLast': [
        [GU.inBroadcast, GU.guestCheck], GU.removeLastSong, '[NUMBER] - Remove the last song of the queue.'
    ],
    'fetchByName': [
        [GU.inBroadcast, GU.guestCheck], GU.fetchByName, '[FILTER] - Place the first song of the queue that matches FILTER at the beginning of the queue.'
    ],
    'fetchLast': [
        [GU.inBroadcast, GU.guestCheck], GU.fetchLast, '- Bring the last song at the beginning of the queue.'
    ],
    'previewRemoveByName': [
        [GU.inBroadcast, GU.guestCheck], GU.previewRemoveByName, '[FILTER] - Get the list of songs that will be remove when calling \'removeByName\' with the same FILTER.'
    ],
    'removeByName': [
        [GU.inBroadcast, GU.guestCheck], GU.removeByName, '[FILTER] - Remove all songs that matches the filter. To clear queue use \'/removeByName allSongs\'. Use the \'previewRemoveByName\' first.'
    ],
    'showPlaylist': [
        [GU.inBroadcast, GU.guestCheck], GU.showPlaylist, '[FILTER] - Get the ID of a particular playlist.'
    ],
    'playPlaylist': [
        [GU.inBroadcast, GU.guestCheck], GU.playPlaylist, 'PLAYLISTID - Play the playlist from the ID given by \'showPlaylist\'.'
    ],
    'skip': [
        [GU.inBroadcast, GU.guestCheck], GU.skip, '- Skip the current song.'
    ],
    'shuffle': [
        [GU.inBroadcast, GU.guestCheck], GU.shuffle, '- Shuffle the current queue.'
    ],
    'peek': [
        [GU.inBroadcast, GU.guestOrWhite], GU.previewSongs, '[NUMBER] - Preview the songs that are in the queue.*'
    ],
    'getPlaylist': [
        [GU.inBroadcast, GU.guestCheck], GU.getPlaylist, '[NUMBER] - Universal Playlist Loader. Usage: /getPlaylist [Playlist ID], see: http://goo.gl/46OwkC'
    ],
};
actionTable = {
    'help': [
        [GU.inBroadcast], GU.help, '- Display this help.*'
    ],
    'ping': [
        [GU.inBroadcast], GU.ping, '- Ping the BOT.'
    ],
    'whoAmI': [
        [GU.inBroadcast], GU.whoamI, '- Return User Name & ID.*'
    ],
    'ask': [
        [GU.inBroadcast], GU.ask, '[QUESTION] - EGSA-tan will answer a Yes or No question.*'
    ],
    'rules': [
        [GU.inBroadcast], GU.rules, '- Rules of the broadcast.*'
    ],
    'roll': [
        [GU.inBroadcast], GU.roll, '[NUMBER] - Test your luck throwing the magical dice. If no number of sides is given, the dice will roll from 1-100.*'
    ],
    'fact': [
        [GU.inBroadcast], GU.fact, '- Display a random fact.*'
    ],
    'seen': [
        [GU.inBroadcast], GU.seen, '[ID/name] - When was the last time user has been seen.'
    ],
    'about': [
        [GU.inBroadcast], GU.about, '- About this software.*'
    ]
};

(function() {
    var callback_start = function() {
        onbeforeunload = null;
        if (GUParams.userReq != '' && GUParams.passReq != '') {
            GS.Services.API.logoutUser().then(function() {
                GS.Services.API.authenticateUser(GUParams.userReq, GUParams.passReq).then(function(user) {
                    window.location = "http://broadcast-nologin/";
                });
            });
        } else
            GU.broadcast();
    }
    var init_check = function() {
        try {
            GS.ready.done(callback_start);
        } catch (e) {
            setTimeout(init_check, 100);
        }
    }
    init_check();
})()