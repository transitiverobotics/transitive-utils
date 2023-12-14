import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Button, Accordion, AccordionContext, Card, Badge }
from 'react-bootstrap';
import ReactWebComponent from './react-web-component';

import { parseCookie } from './client';

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
  }
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
      {timer < 60 && <div>Timeout in: {timer} seconds</div>}
    </div> :
    <div>Timed out. <Button onClick={reset}>
        Resume
      </Button>
    </div>}
  </TimerContext.Provider>;
};

/** A simple error boundary. Usage:
```jsx
 <ErrorBoundary message="Something went wrong">
   <SomeFlakyComponent />
 </ErrorBoundary>
```
*/
export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true };
  }

  componentDidCatch(error, errorInfo) {
    console.warn('ErrorBoundary caught:', error, errorInfo);
  }

  render() {
    return (this.state.hasError ?
      <div>{this.props.message || 'Something went wrong here.'}</div> :
      this.props.children);
  }
};

/* whether or not the given react component allows refs, i.e., is either
 * a functional component wrapped with forwardRef or a class component */
const componentPermitsRefs = (Component) =>
  (Component.$$typeof == Symbol.for('react.forward_ref'))
    || Component.prototype?.render;


/** Create a WebComponent from the given react component and name that is
    reactive to the given attributes (if any). Used in web capabilities.
Example:
```js
    createWebComponent(Diagnostics, 'health-monitoring-device', ['jwt', 'host', 'device'], TR_PKG_VERSION);
```
*/
export const createWebComponent = (Component, name,
    reactiveAttributes = [],
    version = '0.0.0',
    options = {}) => {

    // Only create a ref if the component accepts it. This avoids an ugly
    // error in the console when trying to give a ref to a non-forwardRef-wrapped
    // functional component.
    const compRef = componentPermitsRefs(Component) ? React.createRef() : null;

    class Wrapper extends React.Component {

      onDisconnect = null;

      // state = JSON.parse(JSON.stringify(this.props));
      // state = this.props;
      state = {};

      /* function used by `Component` to register a onDisconnect handler */
      setOnDisconnect(fn) {
        this.onDisconnect = fn;
      }

      webComponentDisconnected() {
        // this ensures that the react component unmounts and all useEffect
        // cleanups are called.
        this.setState({_disconnected: true});
        try {
          this.onDisconnect && this.onDisconnect();
        } catch (e) {
          console.log('Error during onDisconnect of web-component', e);
        }
      }

      /* Note this relies on the changes made in
      github:amay0048/react-web-component#780950800e2962f45f0f029be618bb8b84610c89
      that we used in our copy.
      TODO: move this into our copy, i.e., do it internally to react-web-component
      and update props.
      */
      webComponentAttributeChanged(name, oldValue, newValue) {
        const newState = this.state;
        newState[name] = newValue;
        this.setState(newState);
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
              {...this.state}
              {...this.props}
              setOnDisconnect={this.setOnDisconnect.bind(this)}
              setConfig={this.setConfig.bind(this)}
              />}
        </div>;
      }
    };

    ReactWebComponent.create(Wrapper, name, options.shadowDOM || false,
      reactiveAttributes, compRef);
  };
