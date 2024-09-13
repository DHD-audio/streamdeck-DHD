/// <reference path="libs/js/action.js" />
/// <reference path="libs/js/stream-deck.js" />

/**
 * Streamdeck Plugin for DHD Control API
 *
 * ‼️ Each action button on the streamdeck has the same `uuid` ("audio.dhd.device.btnonoff")
 * and a unique `contextKey` (`context`). This means, we create multiple instances via
 * `mkButtonActionInstance` and manage them in the `instanceRegistry`.
 * When an event (contains `uuid` and `context`) such as `keyUp` is fired on a particular
 * action, the function of corresponding instance in the `instanceRegistry` is called.
 * ⚠️ This delegation is done in `subscribeActionInstances`.
 *
 * TODO: show error on action buttons if websocket is not online
 * TODO: add support for `audio/pots/${potId}/value` path
 */

/**
 * bootstrap the streamdeck plugin
 */
$SD.on("connected", (jsn) => {
  console.log("connected", jsn);

  $SD.onDidReceiveGlobalSettings((jsn) => {
    console.group("onDidReceiveGlobalSettings");
    console.log(jsn);

    const { ipAddress, token } = jsn.payload.settings;
    connectDevice(ipAddress, token);

    console.groupEnd();
  });
  $SD.getGlobalSettings();

  createActionInstances();
  subscribeActionInstances();
});

/***************************************************************************
 ****************************************************************************
 * Streamdeck Action Plugins
 ****************************************************************************
 ***************************************************************************/

/**
 * @type {Map<string, Record<string, (...args: unknown[]) => unknown>>}
 */
const instanceRegistry = new Map();

const actionUuid = "audio.dhd.s52.btnonoff";

function createActionInstances() {
  $SD.on(`${actionUuid}.willAppear`, (jsn) => {
    console.group("willAppear");
    console.log(`Initialize ${actionUuid}`, jsn);

    mkButtonActionInstance(jsn).onWillAppear();

    console.groupEnd();
  });
}

/**
 * Subscribe instance to events
 */
function subscribeActionInstances() {
  [
    ["willDisappear", "onWillDisappear"],
    ["keyUp", "onKeyUp"],
    ["didReceiveSettings", "onDidReceiveSettings"],
  ].forEach(([eventName, callbackName]) => {
    $SD.on(`${actionUuid}.${eventName}`, (jsn) => {
      const { context: contextKey } = jsn;

      const instance = instanceRegistry.get(contextKey);
      if (!instance) {
        console.warn(`no instance found for ${contextKey}`);
        return;
      }

      console.group(callbackName, jsn);
      instance[callbackName](jsn);
      console.groupEnd();
    });
  });
}

/**
 * @param {unknown} jsn
 */
const mkButtonActionInstance = (jsn) => {
  const { context: contextKey } = jsn;

  // make instance singleton
  const instance = instanceRegistry.get(contextKey);
  if (instance) {
    console.log("Instance already exists");
    return instance;
  }

  let path = normalizePath(jsn.payload.settings.path);
  let action = detectTypeOfAction(path);
  let actionState = true;

  return {
    /**
     * The data path that is addressed by the action
     */
    get path() {
      return path;
    },

    /**
     * @returns {string}
     */
    get activeImage() {
      return action === "on" ? onActive : pflActive;
    },

    /**
     * @returns {string}
     */
    get inactiveImage() {
      return action === "on" ? onInactive : pflInactive;
    },

    /**
     * @param {Object} payload - The message payload to query the value from
     * @returns {unknown} Returns the resolved value.
     */
    getValueFromUpdateResponse(payload) {
      const lodashPath = path.replaceAll("/", ".");
      return lodashGet(payload, lodashPath);
    },

    /**
     * Fires when the action appears on the canvas
     *
     * Register the instance
     */
    onWillAppear() {
      instanceRegistry.set(contextKey, this);

      subscribe("add", path, contextKey);
    },

    /**
     * Fires when the action disappears on the canvas
     *
     * Unregister the instance
     */
    onWillDisappear() {
      instanceRegistry.delete(contextKey);

      subscribe("remove", path, contextKey);
    },

    // callback function to retrieve settings
    onDidReceiveSettings(jsn) {
      if (!jsn.payload.settings.path) {
        console.error("No path set in settings");
        return;
      }

      subscribe("remove", path, contextKey);

      console.log("old path ->", path);
      path = normalizePath(jsn.payload.settings.path);
      action = detectTypeOfAction(path);
      console.log("new path ->", path);

      subscribe("add", path, jsn.context);
    },

    /**
     * Fires when releasing a key
     * @param {unknown} jsn
     */
    onKeyUp() {
      const nextActionState = actionState === true ? false : true;
      controlApi.set(path, nextActionState);
    },

    /**
     * Called for every received message from the Control API
     *
     * @param {boolean} value
     */
    updateState(value) {
      console.group(`updateState -> kf: ${path}`);
      actionState = value;
      console.log(`set button to ${actionState} / exchange ${contextKey} icon`);

      $SD.setImage(
        contextKey,
        convertToBase64(actionState ? this.activeImage : this.inactiveImage),
      );

      console.groupEnd();
    },
  };
};

/**
 * Detect type of action: 'pfl' or 'on'
 *
 * @param {string} path
 * @returns {"pfl" | "on"}
 */
function detectTypeOfAction(path) {
  const controlPattern = /^\/?control\/logics\/(\d+)$/;
  if (controlPattern.test(path)) {
    return "on";
  }

  const pflPattern = /pfl\d+$/;
  if (pflPattern.test(path)) {
    return "pfl";
  }

  return "on";
}

/***************************************************************************
 ****************************************************************************
 * DHD Control API
 ****************************************************************************
 ***************************************************************************/

/**
 * @url https://developer.dhd.audio/docs/API/control-api/socket-usage#methods
 */
const controlApi = {
  /**
   * Required after connecting to the WebSocket to authenticate the connection. Without a valid authentication,
   * no other commands will be accepted. Also required when reconnecting.
   *
   * @param {string} token - DHD token
   */
  auth(token) {
    const message = { method: "auth", token };

    console.log(`controlApi: auth`);

    sendMessage(message);
  },

  /**
   * Query a node or value (single time)
   *
   * @param {string} path - the addressing data path
   */
  get(path) {
    const message = { method: "get", path };

    console.log(`controlApi: get -> ${path}`);

    sendMessage(message);
  },

  /**
   * Set one or multiple values Request (single value):
   *
   * @param {string} path - the addressing data path
   * @param {unknown} payload -  the update data. Can be object, array or single value.
   */
  set(path, payload) {
    const message = { method: "set", path, payload };

    console.log(`controlApi: set -> ${path} ->`, message);

    sendMessage(message);
  },

  /**
   * To receive updates for changed values and avoid polling, use subscribe method.
   * Subscribe to a node (e.g. level detect 0):
   *
   * @param {string} path - the addressing data path
   */
  subscribe(path) {
    const message = { method: "subscribe", path };

    console.log(`controlApi: subscribe -> ${path}`);

    sendMessage(message);
  },

  /**
   * @param {unknown} message
   */
  isGetResponse(message) {
    return message.method === "get";
  },

  /**
   * @param {unknown} message
   */
  isSetResponse(message) {
    return message.method === "set";
  },

  /**
   * @param {unknown} message
   */
  isSubscribeResponse(message) {
    return message.method === "subscribe";
  },

  /**
   * @param {unknown} message
   */
  isUpdateResonse(message) {
    return "payload" in message && message.method === "update";
  },

  sendHeartbeat() {
    controlApi.get("/general/_uptime");
  },

  /**
   * @param {unknown} message
   */
  isHeartbeatResponse(message) {
    return (
      controlApi.isGetResponse(message) && message.path === "/general/_uptime"
    );
  },

  /**
   * Method extract payload from `get` and `subscribe` message types.
   *
   * @param {unknown} message
   * @param {string} path
   * @param {(message: unknown) => unknown} onSubscriptionUpdate
   */
  getValueFromMessage(message, path, onSubscriptionUpdate) {
    // the call to `controlApi.get` returns a
    // `{ method: 'get', path: string, payload: boolean | string | number }` message type from the Control API
    if (["get", "set"].includes(message.method)) {
      if (message.success === false) {
        console.error(`error while getting ${path} ->`, message.error);
        return undefined;
      }

      const messagePath = normalizePath(message.path);
      if (messagePath === path) {
        return message.payload;
      }

      // the message was for another recipient
      return undefined;
    }

    // the call to `controlApi.subscribe` returns a
    // `{ method: 'update', path: string, payload: unknown }` message type from the Control API
    if (message.method === "update") {
      return onSubscriptionUpdate(message.payload);
    }

    return undefined;
  },
};

/**
 * @type {Map<string, Array<string>>}
 */
const subscribePaths = new Map();

/**
 * Manage the Control API subscription paths of `subscribePaths`.
 *
 * @param {"add" | "remove" | "open"} method
 * @param {string} path
 * @param {string} context
 */
function subscribe(method, path, context) {
  path = normalizePath(path); // Normalize the path

  switch (method) {
    case "add": {
      console.log("add path", path);

      const subscriptionExists = subscribePaths.has(path);

      // Initialize the path as an array if it doesn't exist yet
      if (!subscriptionExists) {
        subscribePaths.set(path, []);
      }

      // Add context to the list of subscribers for the path
      if (!subscribePaths.get(path).includes(context)) {
        subscribePaths.get(path).push(context);
      }

      console.log(subscribePaths);

      // for new subscriptions -> subscribe to the Control API
      if (!subscriptionExists) {
        controlApi.subscribe(path);
      }

      // get current state for path
      controlApi.get(path);

      return;
    }

    case "remove": {
      console.log("remove path", path);

      // Remove context from the list of subscribers for the path
      if (subscribePaths.has(path)) {
        subscribePaths.set(
          path,
          subscribePaths
            .get(path)
            .filter((subscribedContext) => subscribedContext !== context),
        );

        // If no more subscribers exist for this path, delete the path
        if (subscribePaths.get(path).length === 0) {
          subscribePaths.delete(path);
        }
      }

      return;
    }

    case "open": {
      const sendSubscribeMessage = () => {
        if (!isWebsocketOpen()) {
          console.error("WebSocket is not open, retrying in 1 second");
          setTimeout(sendSubscribeMessage, 1000);

          return;
        }

        console.log("subscribe to all paths", subscribePaths.keys());

        for (const path of subscribePaths.keys()) {
          controlApi.subscribe(path);
          controlApi.get(path);
        }
      };

      sendSubscribeMessage();

      return;
    }
  }
}

/***************************************************************************
 ****************************************************************************
 * Websocket handling
 ****************************************************************************
 ***************************************************************************/

/**
 * The global websocket connection to the DHD Device available
 * for all actions & contexts
 *
 * @type {WebSocket}
 */
let ws;

/**
 * @returns {boolean}
 */
const isWebsocketOpen = () => {
  const isOpen = ws && ws.readyState === WebSocket.OPEN;
  if (!isOpen) console.warn("WebSocket connection not open");

  return isOpen;
};

/**
 * Send message over websocket connection
 *
 * @param {unknown} payload -  the update data. Can be object, array or single value.
 */
const sendMessage = (payload) => {
  // On streamdeck the websocket connection doesn't exist when the pugin is starting
  // -> subscriptions will be created later via `subscribe("open")` call
  if (!isWebsocketOpen()) {
    return;
  }

  ws.send(JSON.stringify(payload));
};

/**
 * Create the websocket connection to the DHD Device and subscribe to messages.
 * When messages are received, they are parsed and sent to the action
 * that are registered in `actionRegistry`.
 *
 * @param {string} ipAddress
 * @param {string} token
 */
function connectDevice(ipAddress, token) {
  console.log("Connecting to DHD Device");

  ws = new WebSocket(`ws://${ipAddress}/api/ws`);
  let heartbeatInterval;

  ws.onopen = () => {
    console.log("WebSocket connection opened");

    const useToken = token && token.length > 0;
    useToken && controlApi.auth(token);

    subscribe("open");

    // Start sending heartbeat every second
    heartbeatInterval = setInterval(controlApi.sendHeartbeat, 5000);
  };

  ws.onmessage = (event) => {
    try {
      const message = JSON.parse(event.data);

      if (controlApi.isHeartbeatResponse(message)) {
        return;
      }

      console.log("WebSocket message received:", message);

      if (controlApi.isUpdateResonse(message)) {
        for (const instance of instanceRegistry.values()) {
          const value = controlApi.getValueFromMessage(
            message,
            instance.path,
            instance.getValueFromUpdateResponse,
          );

          if (value !== undefined) {
            instance.updateState(value);
          }
        }
        return;
      }

      if (
        controlApi.isGetResponse(message) ||
        controlApi.isSetResponse(message)
      ) {
        for (const instance of instanceRegistry.values()) {
          const value = controlApi.getValueFromMessage(
            message,
            instance.path,
            instance.getValueFromUpdateResponse,
          );

          if (value !== undefined) {
            instance.updateState(value);
          }
        }

        return;
      }
    } catch (error) {
      console.error(
        "Failed to parse WebSocket message or handle the message:",
        error,
        event.data,
      );
    }
  };

  ws.onerror = (error) => {
    console.error("WebSocket error:", error);
    // Attempt to reconnect after some time
    setTimeout(connectDevice(ipAddress), 2500);
  };

  ws.onclose = () => {
    console.warn("WebSocket connection closed");

    // Clear the heartbeat interval
    clearInterval(heartbeatInterval);

    // Attempt to reconnect after some time
    setTimeout(connectDevice(ipAddress), 1000);
  };
}

/***************************************************************************
 ****************************************************************************
 * String Utils
 ****************************************************************************
 ***************************************************************************/

function normalizePath(path) {
  // Check if path is undefined or null, and ensure it's a string
  if (typeof path !== "string") {
    console.warn("normalizePath received a non-string path:", path);
    return ""; // Return an empty string or handle it as needed
  }

  // Perform the normalization by replacing multiple slashes and removing leading/trailing slashes
  return path.replace(/\/+/g, "/").replace(/\/$/, "").replace(/^\//, "");
}

/***************************************************************************
 ****************************************************************************
 * Streamdeck Utils
 ****************************************************************************
 ***************************************************************************/

function convertToBase64(svgString) {
  // Convert the SVG string to base64 format
  console.log("Converting SVG to base64");
  // console.log(svgString);
  return "data:image/svg+xml;base64," + btoa(svgString);
}

/***************************************************************************
 ****************************************************************************
 * Lodash
 ****************************************************************************
 ***************************************************************************/

/**
 * Gets the value at `path` of `object`. If the resolved value is
 * `undefined`, the `defaultValue` is returned in its place.
 *
 * @static
 * @since 3.7.0
 * @param {Object} object The object to query.
 * @param {Array|string} path The path of the property to get.
 * @param {unknown} [defaultValue] The value returned for `undefined` resolved values.
 * @returns {unknown} Returns the resolved value.
 * @example
 *
 * var object = { 'a': [{ 'b': { 'c': 3 } }] };
 *
 * _.get(object, 'a[0].b.c');
 * // => 3
 *
 * _.get(object, ['a', '0', 'b', 'c']);
 * // => 3
 *
 * _.get(object, 'a.b.c', 'default');
 * // => 'default'
 *
 *
 * `get` is defined in `lodash.get.js`
 * @docs https://lodash.com/docs/4.17.15#get
 */
const lodashGet = get;
