const React = require('react');
const ReactDOM = require('react-dom');
const { createRoot } = require('react-dom/client');

// const { createRoot } = require('react-dom/client'); // react 18; wip
const retargetEvents = require('react-shadow-dom-retarget-events');
const getStyleElementsFromReactWebComponentStyleLoader = require('./getStyleElementsFromReactWebComponentStyleLoader');
const extractAttributes = require('./extractAttributes');

// require('@webcomponents/shadydom');
// require('@webcomponents/custom-elements');

const lifeCycleHooks = {
  attachedCallback: 'webComponentAttached',
  connectedCallback: 'webComponentConnected',
  disconnectedCallback: 'webComponentDisconnected',
  adoptedCallback: 'webComponentAdopted'
};

module.exports = {
  /*
   * @param {JSX.Element} wrapper: the wrapper component class to be instantiated and wrapped
   * @param {string} tagName - The name of the web component. Has to be minus "-" delimited.
   * @param {boolean} useShadowDom - If the value is set to "true" the web component will use the `shadowDom`. The default value is true.
   */
  create: (wrapper, tagName, useShadowDom = true, compRef = undefined) => {

    const proto = class extends HTMLElement {
      instance = null; // the instance we create of the wrapper

      callConstructorHook() {
        if (this.instance['webComponentConstructed']) {
          this.instance['webComponentConstructed'].apply(this.instance, [this])
        }
      }

      callLifeCycleHook(hook, params = []) {
        const method = lifeCycleHooks[hook];
        if (method && this.instance && this.instance[method]) {
          this.instance[method].apply(this.instance, params);
        }
      }

      connectedCallback() {
        const self = this;
        let mountPoint = self;

        if (useShadowDom) {
          // Re-assign the self (this) to the newly created shadowRoot
          const shadowRoot = self.attachShadow({ mode: 'open' });

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

        createRoot(mountPoint).render(
          // This is where we instantiate the actual component (in its wrapper)
          React.createElement(wrapper, {_element: self, ...extractAttributes(self)})
        );
      }

      disconnectedCallback() {
        this.callLifeCycleHook('disconnectedCallback');
      }

      adoptedCallback(oldDocument, newDocument) {
        this.callLifeCycleHook('adoptedCallback', [oldDocument, newDocument]);
      }

      /* call a function defined in the component, either as a class method, or
      * via useImperativeHandle */
      call(functionName, args) {
        return compRef?.current?.[functionName]?.call(compRef?.current, args);
      }

      /* predefined function to retrieve the pre-defined config object of the
       * state, populated via the pre-defined `setConfig` method given as prop
       * to the wrapped component. */
      getConfig() {
        return this.instance.state.config;
      }
    }

    customElements.define(tagName, proto);

    return proto;
  },
};
