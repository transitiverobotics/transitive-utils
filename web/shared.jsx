import React, { useState, useEffect, useMemo } from 'react';
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

/** The right badge for the level */
export const LevelBadge = ({level}) => levelBadges[level] || <span>{level}</span>;

/** reusable component for showing code */
export const Code = ({children}) => <pre style={styles.code}>
  {children}
</pre>;

export const InlineCode = ({children}) => <tt style={styles.inlineCode}>
  {children}
</tt>;


const intervals = {};

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

  const resetTimer = () => setTimer(duration);

  return timer > 0 ?
  <div>
    { /** Inject prop into children to reset timer */
      React.Children.map(children, (child) =>
        React.cloneElement(child, {resetTimer})
      )
    }
    {timer < duration * 0.5 && <div>Timeout in: {timer} seconds</div>}
  </div>
  :
  <div>Timed out. <Button onClick={resetTimer}>
      Resume
    </Button>
  </div>;
};


/** Create a WebComponent from the given react component and name that is
    reactive to the given attributes (if any). */
export const createWebComponent =
  (Component, name, reactiveAttributes = [], version = '0.0.0') => {

    class Wrapper extends React.Component {

      onDisconnect = null;

      // state = JSON.parse(JSON.stringify(this.props));
      // state = this.props;
      state = {};

      /** function used by `Component` to register a onDisconnect handler */
      setOnDisconnect(fn) {
        this.onDisconnect = fn;
      }

      webComponentDisconnected() {
        this.onDisconnect && this.onDisconnect();
        // this ensures that the react component unmounts and all useEffect
        // cleanups are called.
        this.setState({_disconnected: true});
      }

      /**
  Note this relies on the changed made in
    github:amay0048/react-web-component#780950800e2962f45f0f029be618bb8b84610c89
    that we used in our copy.
    TODO: move this into our copy, i.e., do it internally to react-web-component
  and update props.
      */
      webComponentAttributeChanged(name, oldValue, newValue) {
        // console.log('webComponentAttributeChanged', name, oldValue, newValue, this.props, this.state);
        const newState = this.state;
        newState[name] = newValue;
        this.setState(newState);
      }

      render() {
        // @import url("https://maxcdn.bootstrapcdn.com/bootstrap/4.5.0/css/bootstrap.min.css");
        return <div id={`cap-${name}-${version}`}>
          <style>
            @import url("https://cdn.jsdelivr.net/npm/bootstrap@5.1.3/dist/css/bootstrap.min.css");
          </style>
          {!this.state._disconnected &&
            <Component
              {...this.state}
              {...this.props}
              setOnDisconnect={this.setOnDisconnect.bind(this)}/>}
        </div>;
      }
    };

    ReactWebComponent.create(<Wrapper />, name, false, reactiveAttributes);
  };
