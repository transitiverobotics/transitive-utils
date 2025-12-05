import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Button, Accordion, AccordionContext, Card, Badge, Dropdown,
  ButtonGroup, Form } from 'react-bootstrap';
import _ from 'lodash';

import ReactWebComponent from './react-web-component';
import { parseCookie, decodeJWT } from './client';
import { useCapability } from './hooks';

const F = React.Fragment;

const styles = {
  badge: {
    width: '4em'
  },
  code: {
    color: '#700',
    borderLeft: '3px solid #aaa',
    padding: '0.5em 0px 0.5em 2em',
    backgroundColor: '#f0f0f0',
    borderRadius: '4px',
    marginTop: '0.5em',
  },
  inlineCode: {
    color: '#700',
    margin: '0px 0.5em 0px 0.5em',
  },

  selector: {
    marginBottom: '1em',
  },
  selectorButton: {
    flex: '0 0 auto',
  },
  field: {
    borderBottomLeftRadius: '0px',
    borderTopLeftRadius: '0px',
    marginBottom: '1em',
    flex: '10 1 10000em',
  },
  sourceForm: {
    // display: 'flex',
    // gap: '1rem',
    display: 'inline-block',
    width: '100%',
  },

};

const levelBadges = [
  <Badge bg="success" style={styles.badge}>OK</Badge>,
  <Badge bg="warning" style={styles.badge}>Warn</Badge>,
  <Badge bg="danger" style={styles.badge}>Error</Badge>,
  <Badge bg="secondary" style={styles.badge}>Stale</Badge>,
];

/* The right badge for the level */
export const LevelBadge = ({level}) => levelBadges[level] || <span>{level}</span>;

/** Reusable component for showing code */
export const Code = ({children}) => <pre style={styles.code}>
  {children}
</pre>;

export const InlineCode = ({children}) => <tt style={styles.inlineCode}>
  {children}
</tt>;


const intervals = {};

/** A Timeout component: removes the children once time runs out */
export const TimerContext = React.createContext({});
export const Timer = ({duration, onTimeout, onStart, setOnDisconnect, children}) => {
  duration = duration || 60;
  const [timer, setTimer] = useState(duration);
  const [running, setRunning] = useState(false);
  const id = useMemo(() => Math.random().toString(36).slice(2), []);

  const stop = () => {
    console.log('stopping timer for', id);
    onTimeout && setTimeout(onTimeout, 1);
    clearInterval(intervals[id]);
    intervals[id] = null;
    setRunning(false);
  };

  const startTimer = () => {
    const interval = intervals[id];
    console.log(interval, intervals, timer);
    if (!interval && timer > 0) {
      setRunning(true);
      intervals[id] = setInterval(() =>
        setTimer(t => {
          if (--t > 0) {
            return t;
          } else {
            stop();
          }
        }), 1000);
      onStart && setTimeout(onStart, 1);
    }

    return stop;
  };

  useEffect(() => { timer > 0 && !running && startTimer() }, [timer]);

  useEffect(() => stop, []);

  setOnDisconnect && setOnDisconnect(() => {
    // call on disconnect of the web component
    stop()
  });

  const reset = () => setTimer(duration);

  return <TimerContext.Provider value={{reset, duration, timer}}>
    {timer > 0 ? <div>
      {children}
      {timer < 60 && <div className="tr-timer-counter">Timeout in: {timer} seconds</div>}
    </div> :
    <div className="tr-timer-timeout">Timed out. <Button onClick={reset}>
        Resume
      </Button>
    </div>}
  </TimerContext.Provider>;
};


/** Dynamically load and use the Transitive web component specified in the JWT.
* Embedding Transitive components this way also enables the use of functional
* and object properties, which get lost when using the custom element (Web
* Component) because HTML attributes are strings.
* Example:
* ```jsx
*   <TransitiveCapability jwt={jwt}
*     myconfig={{a: 1, b: 2}}
*     onData={(data) => setData(data)}
*     onclick={() => { console.log('custom click handler'); }}
*   />
* ```
*
* Always loads the capability specified in the JWT and will default to the
* main component for that JWT (`-device` or `-fleet`). To specify a secondary
* component offered by the capability specify `component`, e.g., to load
* `webrtc-video-supervisor` instead of `webrtc-video-device`, provide a device
* JWT for webrtc-video and use:
* ```jsx
*   <TransitiveCapability jwt={jwt}
*     component='webrtc-video-supervisor'
*     auto="true"
*   />
* ```
*/
export const TransitiveCapability = ({
    jwt, host = 'transitiverobotics.com', ssl = true, ...config
  }) => {

    const assertPresent = (value, name) => {
      if (!value) throw new Error(`JWT is missing ${name}`);
    };

    const {id, device, capability} = decodeJWT(jwt);
    // Throw an error when any of the above payload is missing
    assertPresent(id, 'id');
    assertPresent(device, 'device');
    assertPresent(capability, 'capability');

    const type = device == '_fleet' ? 'fleet' : 'device';
    const capName = capability.split('/')[1];
    const name = `${capName}-${type}`;
    const component = config.component || name;

    const { loaded } = useCapability({
      capability,
      name,
      userId: id || config.userId, // accept both id and userId, see #492
      deviceId: device,
      host,
      ssl
    });

    const ref = useRef();
    // Attach functional and object properties to the component when ready and
    // on change
    useEffect(() => {
        ref.current?.instance?.setState(s =>
          ({ ...s, id, jwt, host, ssl, ...config }));
      }, [ref.current, loaded, id, jwt, host, ssl, ...Object.values(config)]);

    // Disrupt the reactive chain of the MutationObserver to the customElement,
    // so we are not competing with it for updating the props.
    const propClone = useMemo(() => ({id, jwt, host, ssl, ...config}), []);

    if (!loaded) return <div>Loading {name}</div>;
    return React.createElement(component, {...propClone, ref});
  };


/** A simple error boundary. Usage:
* ```jsx
*  <ErrorBoundary message="Something went wrong">
*    <SomeFlakyComponent />
*  </ErrorBoundary>
* ```
*/
export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      hasError: false,
      messages: [],
    };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true };
  }

  componentDidCatch(error, errorInfo) {
    console.warn('ErrorBoundary caught:', error, errorInfo);
    this.setState(({messages}) => ({messages: [...messages, error.message]}));
  }

  render() {
    return (this.state.hasError ? <div>
        Error: {this.props.message || this.state.messages?.join(', ')
          || 'Something went wrong here.'}
      </div>
      : this.props.children);
  }
};


export const CapabilityContext = React.createContext({});

/* Only used internally: the actual context provider, given the loaded module */
const LoadedCapabilityContextProvider = (props) => {
  const {children, jwt, id, host, ssl, loadedModule} = props;

  const context = loadedModule.provideContext?.({
    jwt, id, host, ssl, appReact: React
  });

  return <CapabilityContext.Provider value={{ ...context }}>
    {children}
  </CapabilityContext.Provider>;
};

/**
* Context provider for capabilities. Use this to access the front-end API
* provided by some capabilities. Example:
* ```jsx
*  <CapabilityContextProvider jwt={jwt}>
*    <MyROSComponent />
*  </CapabilityContextProvider>
* ```
* where `jwt` is a JWT for a capability that exposes a front-end API. Then use
* `useContext` in `MyROSComponent` to get the exposed data and functions, e.g.:
* ```jsx
* const MyROSComponent = () => {
*   const { ready, subscribe, data } = useContext(CapabilityContext);
*   // When ready, subscribe to the `/odom` topic in ROS1
*   useEffect(() => { ready && subscribe(1, '/odom'); }, [ready]);
*   return <pre>{JSON.stringify(data, true, 2)}</pre>;
* }
* ```
* Where `ready`, `subscribe`, and `data` are reactive variables and functions
* exposed by the capability of the provided JWT. In this example, the latest
* message from the subscribed ROS topics will be available in the capabilities
* namespace in `data`.
* @param {object} props
*/
export const CapabilityContextProvider =
  ({children, jwt, host = undefined, ssl = undefined}) => {

    const {id, device, capability} = decodeJWT(jwt);
    const type = device == '_fleet' ? 'fleet' : 'device';
    const capName = capability.split('/')[1];
    const name = `${capName}-${type}`;

    const {loaded, loadedModule} = useCapability({
      capability,
      name,
      userId: id,
      deviceId: device,
      appReact: React,
      host,
      ssl
    });

    if (!loadedModule) return <div>Loading {capability}</div>;
    return <LoadedCapabilityContextProvider {...{jwt, id, host, ssl, loadedModule}}>
      {children}
    </LoadedCapabilityContextProvider>;
  };


/* whether or not the given react component allows refs, i.e., is either
 * a functional component wrapped with forwardRef or a class component */
const componentPermitsRefs = (Component) =>
  (Component.$$typeof == Symbol.for('react.forward_ref'))
    || Component.prototype?.render;


/** Create a WebComponent from the given react component and name that is
* reactive to all attributes. Used in web capabilities. Example:
* ```js
* createWebComponent(Diagnostics, 'health-monitoring-device', TR_PKG_VERSION);
* ```
*/
export const createWebComponent = (Component, name, version = '0.0.0',
    options = {}) => {

    // Only create a ref if the component accepts it. This avoids an ugly
    // error in the console when trying to give a ref to a non-forwardRef-wrapped
    // functional component.
    const compRef = componentPermitsRefs(Component) ? React.createRef() : null;

    class Wrapper extends React.Component {

      onDisconnect = null;
      state = {};

      componentDidMount() {
        this.props._element.instance = this;
        this.webComponentConstructed(this.props._element);
        this.props._element.callLifeCycleHook('connectedCallback');
      }

      /* function used by `Component` to register a onDisconnect handler */
      setOnDisconnect(fn) {
        this.onDisconnect = fn;
      }

      webComponentConstructed(instance) {
        // Observe all changes to attributes and update React state from it
        const observer = new MutationObserver((mutationRecords) => {
            const update = {};
            mutationRecords.forEach(({attributeName}) => {
              update[attributeName] = instance.getAttribute(attributeName);
            });
            this.setState(old => ({...old, ...update}));
          }).observe(instance, { attributes: true });
      }

      webComponentDisconnected() {
        // This ensures that the react component unmounts and all useEffect
        // cleanups are called.
        this.setState({_disconnected: true});
        try {
          this.onDisconnect && this.onDisconnect();
        } catch (e) {
          console.log('Error during onDisconnect of web-component', e);
        }
      }

      /* method exposed to the wrapped component via prop that allows setting
      * the "config" state variable inside the wrapper (not the component
      * itself). This config is retrieved by the portal for inclusion in the
      * embedding instructions. */
      setConfig(config) {
        this.setState({config});
      }

      render() {
        const stylesheets = options.stylesheets || [
          // 'https://cdn.jsdelivr.net/npm/bootstrap@5.1.3/dist/css/bootstrap.min.css'
          // Bootstrap 5.3.2 css scoped to `.transitive-bs-root`:
          'https://cdn.jsdelivr.net/gh/transitiverobotics/transitive-utils@0.8.3/web/css/bootstrap_transitive-bs-root.min.css'
        ];

        return <div id={`cap-${name}-${version}`}
          className={options.className || 'transitive-bs-root'}>
          <style>
            {stylesheets.map(url => `@import url(${url});`)}
          </style>

          {!this.state._disconnected &&
            <Component ref={compRef}
              {...this.props}
              // Important to keep state *after* props for reactivity to work
              {...this.state}
              setOnDisconnect={this.setOnDisconnect.bind(this)}
              setConfig={this.setConfig.bind(this)}
              />}
        </div>;
      }
    };

    return ReactWebComponent.create(Wrapper, name, options.shadowDOM || false,
      compRef);
  };


/** takes options in the below format and renders a "tree of dropdowns" to
* allow user to select from these options in sequence.
* Format:
* ```js
* { selector: 'video source',
*   field: 'type',
*   options: [
*     { label: 'ROS Topic', // label for this option (in parent selector)
*       value: 'rostopic' // value to use when selected
*       field: 'value', // the field for which options list possible values
*       selector: 'ROS Version', // label for next selector
*       options: [
*         { label: 'ROS1',
*           options: [{
*             label: 'topic1',
*             value: 'topic1'
*           }],
*         }, {
*           label: 'Free form',
*           value: 'free-form',
*           selector: 'Enter text',
*           field: 'textParam',
*         }, {
*           label: 'A Number',
*           value: 'free-form-number',
*           selector: 'Enter number',
*           type: 'number',
*           field: 'numberParam',
*         }, {
*           label: 'A Date',
*           value: 'free-form-date',
*           selector: 'Enter date',
*           type: 'datetime-local',
*           field: 'dateParam',
*         }
*       }
*     },
*     ...
*   ]
* }
* ```
*/
export const TreeSelector = (props) => {
  const {selector, field, options} = props.options;

  const preselectedOption = props.preselected &&
    options.find(o => _.isEqual(o.value, props.preselected[field]));

  // log.debug(preselectedOption);

  const [selected, setSelected] = useState(preselectedOption);
  const select = (choice) => {
    setSelected(choice);
    (choice != selected) && props.onSelect?.({
      selected: {[field]: choice.value},
      // Indicate when there are no more options to select from, i.e., the
      // selection is complete:
      complete: !choice.options && !choice.field
    });
  };

  const dropDowns = <F>
    <Dropdown as={ButtonGroup} style={styles.selector}>
      <Dropdown.Toggle variant="outline-secondary" style={styles.selectorButton}>
        {selected?.label || selector}
      </Dropdown.Toggle>
      <Dropdown.Menu variant="dark">
        {options.map((option, i) =>
          <Dropdown.Item key={i}
            disabled={option.disabled}
            onClick={() => select(option)}>
            {option.label}
          </Dropdown.Item>
        )}
      </Dropdown.Menu>
    </Dropdown>

    {selected?.options ?
      <TreeSelector key={JSON.stringify(selected.value)}
        nested={true}
        options={selected}
        preselected={props.preselected} // TODO: is this right?
        onSelect={(subChoice) => {
          const merged = {
            selected: {[field]: selected.value, ...subChoice.selected},
            complete: subChoice.complete
          };
          props.onSelect?.(merged);
        }}
        />
      : // no options given, just provide an input field
      selected?.field && <Form.Control style={styles.field}
        type={selected.type || 'text'}
        placeholder={selected.selector}
        defaultValue={props.preselected?.[selected.field] || selected.default}
        onBlur={e => {
          props.onSelect?.({
            selected: {
              [field]: selected.value,
              [selected.field]: e.target.value
            },
            complete: e.target.value.length > 0
          });
        }}
        />
    }
  </F>;

  return props.nested ? dropDowns : <div style={styles.sourceForm}>
    <ButtonGroup style={{width: '100%'}}>
      {dropDowns}
    </ButtonGroup>
  </div>;
};
