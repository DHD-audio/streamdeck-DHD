/// <reference path="libs/js/action.js" />
/// <reference path="libs/js/stream-deck.js" />

// bootstrap the streamdeck plugin
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

const actionOnOffUuid = "audio.dhd.rm1.btnonoff";
const actionPflUuid = "audio.dhd.rm1.pflonoff";

const actionHp1Uuid = "audio.dhd.rm1.hp1vol";
const actionHp2Uuid = "audio.dhd.rm1.hp2vol";
const actionOutUuid = "audio.dhd.rm1.outvol";

function createActionInstances() {
  [
    [actionOnOffUuid, ["on", onActive, onInactive]],
    [actionPflUuid, ["pfl1", pflActive, pflInactive]],
  ].forEach(([uuid, args]) => {
    $SD.on(`${uuid}.willAppear`, (jsn) => {
      console.group("willAppear");
      console.log(`Initialize ${actionOnOffUuid}`, jsn);

      mkButtonActionInstance(jsn, ...args).OnWillAppear();

      console.groupEnd();
    });
  });

  [
    [actionHp1Uuid, 35],
    [actionHp2Uuid, 36],
    [actionOutUuid, 37],
  ].forEach(([uuid, apiId]) => {
    $SD.on(`${uuid}.willAppear`, (jsn) => {
      console.group("willAppear");
      console.log(`Initialize ${actionOnOffUuid}`, jsn);

      mkPotiActionInstance(jsn, apiId).OnWillAppear();

      console.groupEnd();
    });
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
    [actionOnOffUuid, actionPflUuid].forEach((uuid) => {
      $SD.on(`${uuid}.${eventName}`, (jsn) => {
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
  });

  [
    ["willDisappear", "onWillDisappear"],
    ["dialUp", "onDialUp"],
    ["dialRotate", "onDialRotate"],
    ["didReceiveSettings", "onDidReceiveSettings"],
  ].forEach(([eventName, callbackName]) => {
    [actionHp1Uuid, actionHp2Uuid, actionOutUuid].forEach((uuid) =>
      $SD.on(`${uuid}.${eventName}`, (jsn) => {
        const { context: contextKey } = jsn;

        const instance = instanceRegistry.get(contextKey);
        if (!instance) {
          console.warn(`no instance found for ${contextKey}`);
          return;
        }

        console.group(callbackName, jsn);
        instance[callbackName](jsn);
        console.groupEnd();
      }),
    );
  });
}

/**
 * @params {unknown} jsn
 * @params {number} potId
 */
const mkPotiActionInstance = (jsn, potId) => {
  const settings = jsn.payload.settings;
  const { context: contextKey } = jsn;

  // make instance singleton
  const instance = instanceRegistry.get(contextKey);
  if (instance) {
    console.log("Instance already exists");
    return instance;
  }

  let indicatorValue = 0;

  const path = () => `audio/pots/${potId}/value`;
  const getValueFromUpdateResponse = ({ payload }) =>
    payload.audio?.pots?.[potId]?.value;

  const poti = {
    /**
     * Transform negative Control API values to positive equivalents.
     *
     * @params {number} num
     */
    toIndicator: (num) => {
      // limit `numg` between -100 and 0
      num = Math.max(-100, Math.min(0, num));

      return 100 + num;
    },

    /**
     * @params {number} num
     */
    fromIndicator: (num) => {
      // limit `numg` between -101 and 100
      num = Math.max(-1, Math.min(100, num));

      return num - 100;
    },
  };

  return {
    path,
    getValueFromUpdateResponse,

    /**
     * Fires when the action appears on the canvas
     *
     * Register the instance
     */
    OnWillAppear() {
      instanceRegistry.set(contextKey, this);

      subscribe("add", path(), contextKey);
    },

    /**
     * Fires when the action disappears on the canvas
     *
     * Unregister the instance
     */
    onWillDisappear() {
      instanceRegistry.delete(contextKey);

      subscribe("remove", path(), contextKey);
    },

    // callback function to retrieve settings
    onDidReceiveSettings(jsn) {
      if (!jsn.payload.settings.keyFunction) {
        console.error("No keyFunction set in settings");
        return;
      }

      subscribe("remove", path(), contextKey);

      console.log("old Key function:", settings.keyFunction);
      Object.assign(settings, jsn.payload.settings);
      console.log("new Key function:", settings.keyFunction);

      subscribe("add", path(), jsn.context);
    },

    onDialRotate(jsn) {
      const { ticks } = jsn.payload;

      const next = indicatorValue + ticks;
      indicatorValue = Math.max(-1, Math.min(100, next));

      controlApi.set(path().replace("/value", ""), {
        value: poti.fromIndicator(indicatorValue),
      });
    },

    /**
     * Fires when pressing the poti
     * @param {unknown} jsn
     */
    onDialUp() {
      const off = -101;
      controlApi.set(path().replace("/value", ""), { value: off });
    },

    /**
     * Called for every received message from the Control API
     *
     * @param {number} value
     * @param {string} contextKey
     */
    updateState(value, contextKey) {
      console.group(`updateState: ${value}`);

      indicatorValue = poti.toIndicator(value);
      $SD.setFeedback(contextKey, {
        indicator: indicatorValue,
        value: value === -101 ? "OFF" : `${value} dB`,
      });

      console.groupEnd();
    },
  };
};

/**
 * @params {unknown} jsn
 * @params {string} keyFunctionName
 * @params {string} activeImage
 * @params {string} inactiveImage
 */
const mkButtonActionInstance = (
  jsn,
  keyFunctionName,
  activeImage,
  inactiveImage,
) => {
  const settings = jsn.payload.settings;
  const { context: contextKey } = jsn;

  // make instance singleton
  const instance = instanceRegistry.get(contextKey);
  if (instance) {
    console.log("Instance already exists");
    return instance;
  }

  let actionState = true;

  const path = () =>
    `audio/mixers/0/faders/${settings.keyFunction}/${keyFunctionName}`;
  const getValueFromUpdateResponse = ({ payload }) =>
    payload.audio.mixers?.[0]?.faders[settings.keyFunction]?.[keyFunctionName];

  return {
    path,
    getValueFromUpdateResponse,

    /**
     * Fires when the action appears on the canvas
     *
     * Register the instance
     */
    OnWillAppear() {
      instanceRegistry.set(contextKey, this);

      subscribe("add", path(), contextKey);
    },

    /**
     * Fires when the action disappears on the canvas
     *
     * Unregister the instance
     */
    onWillDisappear() {
      instanceRegistry.delete(contextKey);

      subscribe("remove", path(), contextKey);
    },

    // callback function to retrieve settings
    onDidReceiveSettings(jsn) {
      if (!jsn.payload.settings.keyFunction) {
        console.error("No keyFunction set in settings");
        return;
      }

      subscribe("remove", path(), contextKey);

      console.log("old Key function:", settings.keyFunction);
      Object.assign(settings, jsn.payload.settings);
      console.log("new Key function:", settings.keyFunction);

      subscribe("add", path(), jsn.context);
    },

    /**
     * Fires when releasing a key
     * @param {unknown} jsn
     */
    onKeyUp() {
      const nextActionState = actionState === true ? false : true;
      controlApi.set(path(), nextActionState);
    },

    /**
     * Called for every received message from the Control API
     *
     * @param {boolean} value
     * @param {string} contextKey
     */
    updateState(value, contextKey) {
      console.group(
        `updateState -> kf: ${settings.keyFunction} kfN: ${keyFunctionName}`,
      );
      actionState = value;
      console.log(`set button to ${actionState} / exchange ${contextKey} icon`);

      $SD.setImage(
        contextKey,
        convertToBase64(actionState ? activeImage : inactiveImage),
      );

      console.groupEnd();
    },
  };
};

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
   * @param {string} path - the data path you are addressing
   */
  get(path) {
    const message = { method: "get", path };

    console.log(`controlApi: get -> ${path}`);

    sendMessage(message);
  },

  /**
   * Set one or multiple values Request (single value):
   *
   * @param {string} path - the data path you are addressing
   * @param {unknown} payload -  the update data. Can be object, array or single value.
   */
  set(path, payload) {
    const message = { method: "set", path, payload };

    console.log(`controlApi: set -> ${path} -> ${message}`);

    sendMessage(message);
  },

  /**
   * To receive updates for changed values and avoid polling, use subscribe method.
   * Subscribe to a node (e.g. level detect 0):
   *
   * @param {string} path - the data path you are addressing
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
    if (message.method === "get") {
      if (message.path === path) {
        return message.payload;
      }

      // the message was for another recipient
      return undefined;
    }

    // the call to `controlApi.subscribe` returns a
    // `{ method: 'update', path: string, payload: unknown }` message type from the Control API
    if (message.method === "update") {
      return onSubscriptionUpdate(message);
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
        for (const [contextKey, instance] of instanceRegistry.entries()) {
          const value = controlApi.getValueFromMessage(
            message,
            instance.path(),
            instance.getValueFromUpdateResponse,
          );

          if (value !== undefined) {
            instance.updateState(value, contextKey);
          }
        }
        return;
      }

      if (controlApi.isGetResponse(message)) {
        message.path = normalizePath(message.path);

        for (const [contextKey, instance] of instanceRegistry.entries()) {
          const value = controlApi.getValueFromMessage(
            message,
            instance.path(),
            instance.getValueFromUpdateResponse,
          );

          if (value !== undefined) {
            instance.updateState(value, contextKey);
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
