import React, {useEffect, useState, useRef} from "react";

const Game = () => {
  const [socket, setSocket] = useState(null);
  const [pub, setPub] = useState(null);
  const [me, setMe] = useState(null);
  const textareaRef = useRef();

  const room = window.location.search.substr(1);

  useEffect(() => {
    if (window.location.pathname !== "/play") return;

    const socket = io(window.location.protocol + "//" + window.location.host);
    socket.on('connect', function () {
      socket.on('pub', _pub => setPub(_pub));
      socket.on('me', _me => setMe(_me));
      socket.emit('join', room);
    });

    setSocket(socket);
    return () => {
      setSocket(null);
      socket.disconnect();
    };
  }, []);

  useEffect(() => {
    if (textareaRef.current)
      textareaRef.current.scrollTop = textareaRef.current.scrollHeight;
  }, [pub?.msgs?.length]);

  if (window.location.pathname === "/" || !room)
    return (
      <input type="submit" value="New Room"
        onClick={() => window.location = "/play?" + Math.random().toString(16).substr(2, 8)} />
    );

  if (pub === null || me === null) return <p>Joining room <tt>{room}</tt>...</p>;

  let status = "Status: ";
  if (pub.names[0] === null) status += 'Waiting for Player A ';
  else if (pub.names[1] === null) status += 'Waiting for Player B ';
  else {
    if (me.goal === 2) status += 'Playing to Draw';
    else if (me.goal === me.idx) status += 'Playing to Win';
    else if (me.goal === 1-me.idx) status += 'Playing to Lose';
    else status += 'Playing';
  }

  let toMove = false;
  if (pub.names.includes(null)) status += "";
  else if (pub.end !== null) status += " (Round End)";
  else if (me.idx === -1) status += ' (Spectating)';
  else if (pub.turn === me.idx) { status += ' (Your Move)'; toMove = true; }

  const {msgs, board, ...debug} = pub;

  return (<>
    <p>
      {status}
      {
        pub.names.includes(null) ?
          <input type="submit" value="Join Game" onClick={() => socket.emit('seat', prompt("Name?"))} disabled={me.idx !== -1} />
        : null
      }
    </p>
    <table><tbody>
      {pub.board.map((row, i) => <tr key={i}>
        {row.map((x, j) => <td key={j}>
          <button style={{width: "2rem"}} onClick={() => socket.emit('play', {i, j})} disabled={!toMove}>{x === ' ' ? <>&nbsp;</> : x}</button>
        </td>)}
      </tr>)}
    </tbody></table>
    {
      pub.names.includes(null) ? null : <>
        <p>{"Player A " + (pub.names[0] !== null ? " (" + pub.names[0] + ")" : "") + " is " +
          (pub.xplayer === 0 ? "X" : "O") + " with " + pub.scores[0] + " points"}</p>
        <p>{"Player B " + (pub.names[1] !== null ? " (" + pub.names[1] + ")" : "") + " is " +
          (pub.xplayer === 0 ? "O" : "X") + " with " + pub.scores[1] + " points"}</p>
      </>
    }
    <p>{
      (pub.end !== null && me.idx !== -1) ?
        <input type="submit" value="Next Round" onClick={() => socket.emit('next')} />
        : null
    }</p>
    <p>Game log:</p>
    <textarea readOnly style={{width: "800px", height: "400px", overflowY: "scroll"}} ref={textareaRef}
      value={pub.msgs.map(([ts, m], i) =>
        "[" + new Date(ts).toLocaleString('en-us', {dateStyle: "short", timeStyle: "medium"}) +
        "] " + m).join("\n")
      } />
  </>);
};

export default () => <>
  <h1>TickTackToek</h1>
  <p>
    <a href="https://www.smbc-comics.com/comic/incomplete">Info</a>
    {" | "}
    <a href="http://kuilin.net/">Author</a>
    {" | "}
    <a href="https://github.com/likuilin/ticktacktoek">Source</a>
  </p>
  <Game />
</>;
