const React = require('react');
const ReactDOM = require('react-dom');
const retargetEvents = require('react-shadow-dom-retarget-events');
const getStyleElementsFromReactWebComponentStyleLoader = require('./getStyleElementsFromReactWebComponentStyleLoader');
const extractAttributes = require('./extractAttributes');

require('@webcomponents/shadydom');
require('@webcomponents/custom-elements');

const lifeCycleHooks = {
  attachedCallback: 'webComponentAttached',
  connectedCallback: 'webComponentConnected',
  disconnectedCallback: 'webComponentDisconnected',
  attributeChangedCallback: 'webComponentAttributeChanged',
  adoptedCallback: 'webComponentAdopted'
};

function callInstanceLifeCycleHook(instance, hook, params) {
  const instanceParams = params || [];
  const instanceMethod = lifeCycleHooks[hook];

  if (instanceMethod && instance && instance[instanceMethod]) {
    instance[instanceMethod].apply(instance, instanceParams);
  }
}

function callInstanceConstructorHook(instance, webComponentInstance) {
  if (instance['webComponentConstructed']) {
    instance['webComponentConstructed'].apply(instance, [webComponentInstance])
  }
}


module.exports = {
  /**
   * @param {JSX.Element} app
   * @param {string} tagName - The name of the web component. Has to be minus "-" delimited.
   * @param {boolean} useShadowDom - If the value is set to "true" the web component will use the `shadowDom`. The default value is true.
   * @param {string[]} observedAttributes - The observed attributes of the web component
   */
  create: (app, tagName, useShadowDom = true, observedAttributes = [],
  // create: (Wrapper, tagName, useShadowDom = true, observedAttributes = [],
      compRef = undefined) => {
    let appInstance;


    function callConstructorHook(webComponentInstance) {
      if (appInstance['webComponentConstructed']) {
        appInstance['webComponentConstructed'].apply(appInstance, [webComponentInstance])
      }
    }

    function callLifeCycleHook(hook, params) {
      const instanceParams = params || [];
      const instanceMethod = lifeCycleHooks[hook];

      if (instanceMethod && appInstance && appInstance[instanceMethod]) {
        appInstance[instanceMethod].apply(appInstance, instanceParams);
      }
    }

    const proto = class extends HTMLElement {
      appRealInstance = null;

      static get observedAttributes() {
        return observedAttributes;
      }

      callConstructorHook(webComponentInstance) {
        if (this.appInstance['webComponentConstructed']) {
          this.appInstance['webComponentConstructed'].apply(this.appInstance, [webComponentInstance])
        }
      }

      callLifeCycleHook(hook, params) {
        const instanceParams = params || [];
        const instanceMethod = lifeCycleHooks[hook];

        if (instanceMethod && this.appInstance && this.appInstance[instanceMethod]) {
          this.appInstance[instanceMethod].apply(this.appInstance, instanceParams);
        }
      }

      connectedCallback() {
        const webComponentInstance = this;
        let mountPoint = webComponentInstance;

        if (useShadowDom) {
          // Re-assign the webComponentInstance (this) to the newly created shadowRoot
          const shadowRoot = webComponentInstance.attachShadow({ mode: 'open' });
          // Re-assign the mountPoint to the newly created "div" element
          mountPoint = document.createElement('div');

          // Move all of the styles assigned to the react component inside of
          // the shadowRoot. By default this is not used, only if the library is
          //  explicitly installed
          const styles = getStyleElementsFromReactWebComponentStyleLoader();
          styles.forEach((style) => {
            shadowRoot.appendChild(style.cloneNode(shadowRoot));
          });

          shadowRoot.appendChild(mountPoint);

          retargetEvents(shadowRoot);
        }

        // const instance =
        //     React.createElement(Wrapper, extractAttributes(webComponentInstance));
        const self = this;
        ReactDOM.render(
          React.cloneElement(app, extractAttributes(webComponentInstance)),
          // instance,
          mountPoint, function() {
            console.log('appInstance to be overwritten', appInstance);
            // appInstance = this;
            self.appInstance = this;
            // appInstance = instance;
            self.callConstructorHook(webComponentInstance);
            // callInstanceConstructorHook(this, webComponentInstance);
            self.callLifeCycleHook('connectedCallback');
            // callInstanceLifeCycleHook(this, 'connectedCallback');

            // this.disconnectedCallback = () => {
            //   console.log('disconnecting');
            //   callInstanceLifeCycleHook(this, 'disconnectedCallback');
            // };
            // this.attributeChangedCallback =
            //   (attributeName, oldValue, newValue, namespace) => {
            //     callInstanceLifeCycleHook(this, 'attributeChangedCallback',
            //       [attributeName, oldValue, newValue, namespace]);
            //   };
            // this.adoptedCallback = (oldDocument, newDocument) => {
            //   callInstanceLifeCycleHook(this, 'adoptedCallback',
            //     [oldDocument, newDocument]);
            // };

            // this.getConfig = () => {
            //   return this.state.config;
            // }

          });
      }
      disconnectedCallback () {
        this.callLifeCycleHook('disconnectedCallback');
      }
      attributeChangedCallback (attributeName, oldValue, newValue, namespace) {
        this.callLifeCycleHook('attributeChangedCallback',
          [attributeName, oldValue, newValue, namespace]);
      }
      adoptedCallback (oldDocument, newDocument) {
        this.callLifeCycleHook('adoptedCallback', [oldDocument, newDocument]);
      }

      /** call a function defined in the component, either as a class method, or
      * via useImperativeHandle */
      call(functionName, args) {
        return compRef?.current?.[functionName]?.call(compRef?.current, args);
      }

      /** predefined function to retrieve the pre-defined config object of the
       * state, populated via the pre-defined `setConfig` method given as prop
       * to the wrapped component. */
      getConfig() {
        return this.appInstance.state.config;
      }
    }

    customElements.define(tagName, proto);
  },
};
