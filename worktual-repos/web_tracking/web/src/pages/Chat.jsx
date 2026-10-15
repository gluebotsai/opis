import { useState } from 'react';
import Navbar from '../components/Navbar';
import ChatInterface from '../components/ChatInterface';

export default function Chat() {
  const [pendingMessage] = useState(() => sessionStorage.getItem('pendingChatMessage'));

  return (
    <>
      <Navbar />
      <div className="container chat-page-container">
        <ChatInterface fullPage autoSendMessage={pendingMessage} />
      </div>
    </>
  );
}
