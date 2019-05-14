/**
 * ChatService.js handles all functions calling space-cloud to retrieve chats / users / messages.
 * @author 8byr0 <https://github.com/8byr0>
 */

import { store } from '../helpers/store';
import { or, cond } from "space-api";
import { config } from './config';

/**
 * Convert an array of users coming from Space-Cloud to a hashed object.
 * Each key of the returned object is a user ID, this allows faster access 
 * to data throughout app.
 * @param {Array<Object>} rawUsers An array of users coming from Space-Cloud 
 * @returns {Object}
 */
const convertRawUsersToHasedObject = (rawUsers) => {
    let users = {}
    rawUsers.forEach((elt) => {
        users[elt._id] = elt
    })
    users["ALL"] = { _id: "ALL", name: 'ALL' }
    return users;
}

/**
 * Create a new chat with a partner. This function also handles 
 * adding metadata (_id, creation time, from...)
 * @param {string} partnerID ID of the partner to chat with 
 * @returns {Promise}
 */
const createChat = (partnerID) => {
    return new Promise((resolve, reject) => {
        const user = store.getState().user.user;
        const chat = { _id: config.generateId(), to: partnerID, from: user._id, creation: new Date() }
        config.db.insert("chats")
            .one(chat)
            .then(res => {
                resolve(chat);
            }).catch((error) => {
                reject(error);
            });
    });
}

/**
 * Send a message to a given chat. This function also handles 
 * adding metadata (_id, time, read, from...)
 * @param {string} chatID ID of the Chat to send to.
 * @param {string} text Text of the message.
 */
const sendMessage = (chatID, text) => {
    return new Promise((resolve, reject) => {
        const user = store.getState().user.user;

        config.db.insert("messages")
            .one({
                _id: config.generateId(),
                text: text,
                read: false,
                chat_id: chatID,
                from: user._id,
                time: new Date()
            })
            .then(res => {
                // Verify if request is successful
                if (res.status !== 200) {
                    reject("User not allowed to sign in");
                }
                resolve(res);
            }).catch((error) => {
                reject(error);
            });
    });
}

/**
 * Update a message metadata. This is used for read hook, 
 * in order to update the `read` attribute.
 * @param {Object} message the message to update
 */
function updateMessage(message) {
    return new Promise((resolve, reject) => {
        config.db.updateOne('messages').where(cond('_id', '==', message._id))
            .set(message).apply().then(res => (resolve(res))).catch(err => { throw err });
    });
}


/**
 * Retrieve all the messages belonging to active user.
 * It was used in the premices of this app to fetch messages at launch time
 * but is no longer used since startmessagesRealtime will handle initial setup 
 * by returning all the messages.
 * It was left in this file for demonstration purpose.
 * @deprecated
 * @returns {Promise} that will resolve with a list of messages, this is not a simple array
 * but a hashed object (each key of this object is a chat ID, for faster access). 
 * */
const getMessages = () => {
    return new Promise((resolve, reject) => {
        const user = store.getState().user.user;

        const condition = or(cond("to", "==", user._id), cond("from", "==", user._id));

        config.db.get("messages").where(condition).apply().then(res => {
            if (res.status === 200) {
                let messages = {}

                res.data.result.forEach((elt) => {
                    const key = elt.chat_id
                    if (!messages[key]) {
                        messages[key] = []
                    }
                    messages[key].push(elt)
                })
                messages["ALL"] = []

                resolve(messages);
            }
        }).catch((err) => {
            reject(err);
        });
    });
}

/**
 * Retrieve all the users belonging to active user.
 * It was used in the premices of this app to fetch users at launch time
 * but is no longer used since startUsersRealtime will handle initial setup 
 * by returning all the users.
 * It was left in this file for demonstration purpose.
 * @deprecated
 * @returns {Promise} that will resolve with a list of users, this is not a simple array
 * but a hashed object generated by [convertRawUsersToHashedObject()] (each key of this object 
 * is a user ID, for faster access).
 */
const getUsers = () => {
    return new Promise((resolve, reject) => {
        const user = store.getState().user.user;
        const condition = cond("_id", "!=", user._id);

        config.db.get("users").where(condition).apply().then(res => {
            if (res.status === 200) {
                let users = convertRawUsersToHasedObject(res.data.result)
                resolve(users);
            }
        }).catch((err) => {
            reject(err)
        });
    });
}

/**
 * Retrieve all the chats belonging to active user.
 * It was used in the premices of this app to fetch chats at launch time
 * but is no longer used since startChatsRealtime will handle initial setup 
 * by returning all the chats.
 * It was left in this file for demonstration purpose.
 * @deprecated
 * @returns {Promise} that will resolve with a list of chats
 */
const getChats = () => {
    return new Promise((resolve, reject) => {
        const user = store.getState().user.user;

        const condition = or(
            cond("from", "==", user._id),
            cond("to", "==", user._id),
            cond("to", "==", "ALL")
        );

        config.db.get("chats").where(condition).apply().then((res) => {
            if (res.status === 200) {
                resolve(res.data.result);
            }
        }).catch((err) => {
            reject(err);
        });
    });
}

///////////////////////////////
//     REALTIME TRIGGERS     //
///////////////////////////////

/**
 * Get an observable that will be triggered each time the list of messages belonging to a chat
 * is updated (insertion, read hook triggered...).
 * @param {string} chatID the id of the chat to listen to
 * @returns {Observable} An observable triggering each time a message matches provided chat ID
 */
const startMessagesRealtime = (chatID) => {
    const condition = cond("chat_id", "==", chatID)

    return config.db.liveQuery("messages").where(condition)
}

/**
 * Get an observable that will be triggered each time the users 
 * list is updated (active status changed, new user...).
 * @returns {Observable} An observable triggering each time a user is added / updated.
 */
const startUsersRealtime = () => {
    return config.db.liveQuery("users");
}

/**
 * Get an observable that will be triggered each time a new chat is 
 * started with active user.
 * @returns {Observable} An observable triggering each time a chat matches active user ID
 */
const startChatsRealtime = () => {
    const user = store.getState().user.user;

    // If `to` or `from` is active user ID, then it's a chat belonging to him.
    // We had ALL condition as it's a specific case
    const condition = or(
        or(cond("to", "==", user._id), cond('from', '==', user._id), cond('to', '==', 'ALL')),
    );

    return config.db.liveQuery("chats").where(condition);
}

export const ChatService = {
    startMessagesRealtime,
    startChatsRealtime,
    startUsersRealtime,
    sendMessage,
    createChat,
    updateMessage
}