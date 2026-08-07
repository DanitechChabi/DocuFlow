import React, { useState, useEffect, useRef } from 'react';
import { X, Send, MessageCircle, ArrowLeft, ChevronRight, Paperclip, File, Download } from 'lucide-react';
import { messageService } from '../services/messageService';
import { authService } from '../services/authService';
import { uploadService } from '../services/uploadService';

const userColors = [
  'from-docuflow-secondary to-blue-600',
  'from-emerald-500 to-teal-600',
  'from-violet-500 to-purple-600',
  'from-rose-500 to-pink-600',
  'from-amber-500 to-orange-600',
  'from-cyan-500 to-sky-600',
];

const getInitialsColor = (id) => userColors[id % userColors.length];

const MessagingPanel = ({ isOpen, onClose }) => {
  const currentUser = authService.getCurrentUser();
  const [view, setView] = useState('conversations');
  const [conversations, setConversations] = useState([]);
  const [messages, setMessages] = useState([]);
  const [activeUser, setActiveUser] = useState(null);
  const [users, setUsers] = useState([]);
  const [textInput, setTextInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [pendingFiles, setPendingFiles] = useState([]);
  const [uploadedFiles, setUploadedFiles] = useState([]); // files already uploaded → { stored_name, url, original_name }
  const [filesUploading, setFilesUploading] = useState(false);
  const messagesEndRef = useRef(null);
  const chatInputRef = useRef(null);
  const fileInputRef = useRef(null);

  useEffect(() => {
    if (isOpen) {
      fetchConversations();
    } else {
      setTimeout(() => {
        setView('conversations');
        setActiveUser(null);
        setMessages([]);
        setPendingFiles([]);
        setUploadedFiles([]);
      }, 300);
    }
  }, [isOpen]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    if (view === 'chat' && chatInputRef.current) {
      chatInputRef.current.focus();
    }
  }, [view]);

  const fetchConversations = async () => {
    try {
      const data = await messageService.getConversations();
      setConversations(data);
    } catch (err) {
      console.error('Erreur chargement conversations', err);
    }
  };

  const fetchUsers = async () => {
    setLoading(true);
    try {
      const data = await messageService.getUsers();
      setUsers(data);
    } catch (err) {
      console.error('Erreur chargement utilisateurs', err);
    } finally {
      setLoading(false);
    }
  };

  const openConversation = async (user) => {
    setActiveUser(user);
    setView('chat');
    try {
      const data = await messageService.getConversation(user.id);
      setMessages(data);
      await messageService.markConversationAsRead(user.id);
      fetchConversations();
    } catch (err) {
      console.error('Erreur chargement messages', err);
    }
  };

  // Upload des fichiers avant envoi du message
  const handleFileSelect = async (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    setFilesUploading(true);
    setPendingFiles(prev => [...prev, ...files]);
    try {
      for (const file of files) {
        const result = await uploadService.uploadMessageFile(file);
        setUploadedFiles(prev => [...prev, result]);
      }
    } catch (err) {
      console.error('Erreur upload fichier', err);
    } finally {
      setFilesUploading(false);
      e.target.value = '';
    }
  };

  const removePendingFile = (index) => {
    setPendingFiles(prev => prev.filter((_, i) => i !== index));
    setUploadedFiles(prev => prev.filter((_, i) => i !== index));
  };

  const handleSend = async () => {
    if ((!textInput.trim() && uploadedFiles.length === 0) || !activeUser || sending) return;
    const content = textInput.trim();
    setTextInput('');
    setSending(true);

    // Optimistic update
    const tempMsg = {
      id: 'temp', sender_id: currentUser?.id, receiver_id: activeUser.id,
      content, created_at: new Date().toISOString(), is_read: false,
      attachments: uploadedFiles
    };
    setMessages(prev => [...prev, tempMsg]);
    setPendingFiles([]);
    setUploadedFiles([]);

    try {
      // Envoyer les métadonnées des fichiers pour les lier au message
      const filesMeta = uploadedFiles.map(f => ({
        original_name: f.original_name,
        stored_name: f.stored_name,
        mime_type: f.mime_type,
        file_size: f.file_size,
        cloudinary_public_id: f.cloudinary_public_id || null,
        secure_url: f.secure_url || null,
      }));
      const msg = await messageService.sendMessage(activeUser.id, content, filesMeta);
      setMessages(prev => prev.map(m =>
        m.id === 'temp' ? { ...msg, sender_name: currentUser?.full_name, receiver_name: activeUser.full_name } : m
      ));
    } catch (err) {
      setMessages(prev => prev.filter(m => m.id !== 'temp'));
      console.error('Erreur envoi message', err);
    } finally {
      setSending(false);
    }
  };

  const handleSendKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const startNewMessage = async () => {
    await fetchUsers();
    setView('new');
  };

  const selectNewUser = async (user) => {
    setActiveUser(user);
    setMessages([]);
    setView('chat');
  };

  const goBack = () => {
    if (view === 'chat') {
      setView('conversations');
      setActiveUser(null);
      setMessages([]);
      setPendingFiles([]);
      setUploadedFiles([]);
      fetchConversations();
    } else if (view === 'new') {
      setView('conversations');
    }
  };

  const formatTime = (dateStr) => {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);
    if (diffMins < 1) return "À l'instant";
    if (diffMins < 60) return `Il y a ${diffMins}min`;
    if (diffHours < 24) return `Il y a ${diffHours}h`;
    if (diffDays < 7) return `Il y a ${diffDays}j`;
    return date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
  };

  const formatMessageTime = (dateStr) => {
    if (!dateStr) return '';
    return new Date(dateStr).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  if (!isOpen) return null;

  return (
    <>
      <div className="fixed inset-0 bg-slate-900/30 backdrop-blur-sm z-40 animate-fade-in" onClick={onClose} />

      <div className="fixed top-0 right-0 h-full w-full max-w-md bg-white shadow-elevated z-50 animate-slide-in-right flex flex-col">
        {/* Header */}
        <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between bg-white flex-shrink-0">
          <div className="flex items-center gap-3">
            {view !== 'conversations' && (
              <button onClick={goBack} className="p-1.5 hover:bg-slate-100 rounded-lg transition-colors text-slate-500">
                <ArrowLeft size={20} />
              </button>
            )}
            <div className="p-2 bg-gradient-to-br from-docuflow-secondary to-blue-600 text-white rounded-xl shadow-sm">
              <MessageCircle size={20} />
            </div>
            <div>
              <h3 className="font-bold text-slate-800 text-sm">
                {view === 'conversations' && 'Messagerie'}
                {view === 'chat' && (activeUser?.full_name || 'Chat')}
                {view === 'new' && 'Nouveau message'}
              </h3>
              {view === 'chat' && activeUser && (
                <p className="text-[10px] text-slate-400 uppercase font-semibold tracking-wider">{activeUser.role}</p>
              )}
            </div>
          </div>

          <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-xl transition-colors text-slate-400">
            <X size={20} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto bg-slate-50/30">
          {/* Conversations list */}
          {view === 'conversations' && (
            <div className="p-4 space-y-1.5">
              {conversations.length === 0 ? (
                <div className="text-center py-16 px-4">
                  <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-4">
                    <MessageCircle size={32} className="text-slate-300" />
                  </div>
                  <p className="text-slate-500 font-semibold mb-1">Aucune conversation</p>
                  <p className="text-sm text-slate-400 mb-6">Échangez avec les autres utilisateurs</p>
                  <button onClick={startNewMessage} className="btn-primary">
                    Nouveau message
                  </button>
                </div>
              ) : (
                <>
                  {conversations.map((conv) => (
                    <button
                      key={conv.id}
                      onClick={() => openConversation(conv)}
                      className="w-full flex items-center gap-4 p-4 rounded-xl bg-white border border-slate-100 hover:border-docuflow-secondary/30 hover:shadow-md transition-all text-left group"
                    >
                      <div className="relative flex-shrink-0">
                        <div className={`w-12 h-12 rounded-full bg-gradient-to-br ${getInitialsColor(conv.id)} flex items-center justify-center text-white font-bold text-sm shadow-sm`}>
                          {conv.full_name?.charAt(0).toUpperCase() || '?'}
                        </div>
                        {conv.unread_count > 0 && (
                          <span className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center shadow-sm">
                            {conv.unread_count > 9 ? '9+' : conv.unread_count}
                          </span>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between mb-0.5">
                          <span className="text-sm font-bold text-slate-800">{conv.full_name}</span>
                          {conv.last_message_at && (
                            <span className="text-[10px] text-slate-400 flex-shrink-0 ml-2">{formatTime(conv.last_message_at)}</span>
                          )}
                        </div>
                        <p className="text-xs text-slate-500 truncate">
                          {conv.last_message_sender_id === currentUser?.id ? (
                            <span className="text-slate-400">Vous : </span>
                          ) : null}
                          {conv.last_message || 'Commencez une conversation'}
                        </p>
                      </div>
                      <ChevronRight size={16} className="text-slate-300 group-hover:text-docuflow-secondary transition-colors flex-shrink-0" />
                    </button>
                  ))}
                  <div className="pt-3">
                    <button onClick={startNewMessage}
                      className="w-full py-3 text-center text-sm font-bold text-docuflow-secondary hover:bg-blue-50 rounded-xl transition-colors border-2 border-dashed border-slate-200 hover:border-docuflow-secondary/50">
                      + Nouvelle conversation
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

          {/* New message user selection */}
          {view === 'new' && (
            <div className="p-4 space-y-1.5">
              {loading ? (
                <div className="flex justify-center py-12">
                  <div className="w-8 h-8 border-[3px] border-slate-200 border-t-slate-900 rounded-full animate-spin"></div>
                </div>
              ) : (
                users.map((u) => (
                  <button key={u.id} onClick={() => selectNewUser(u)}
                    className="w-full flex items-center gap-4 p-4 rounded-xl bg-white border border-slate-100 hover:border-docuflow-secondary/30 hover:shadow-md transition-all text-left group">
                    <div className={`w-10 h-10 rounded-full bg-gradient-to-br ${getInitialsColor(u.id)} flex items-center justify-center text-white font-bold text-sm shadow-sm flex-shrink-0`}>
                      {u.full_name?.charAt(0).toUpperCase() || '?'}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold text-slate-800">{u.full_name}</p>
                      <p className="text-xs text-slate-400 capitalize">{u.role}</p>
                    </div>
                    <ChevronRight size={16} className="text-slate-300 group-hover:text-docuflow-secondary transition-colors flex-shrink-0" />
                  </button>
                ))
              )}
            </div>
          )}

          {/* Chat view */}
          {view === 'chat' && (
            <div className="flex flex-col h-full">
              <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {messages.length === 0 && (
                  <div className="text-center py-12">
                    <div className="w-14 h-14 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-3">
                      <MessageCircle size={28} className="text-slate-300" />
                    </div>
                    <p className="text-slate-400 font-medium">Aucun message</p>
                    <p className="text-xs text-slate-300">Envoyez le premier message</p>
                  </div>
                )}
                {messages.map((msg) => {
                  const isMine = msg.sender_id === currentUser?.id;
                  const hasAttachments = msg.attachments && msg.attachments.length > 0;
                  return (
                    <div key={msg.id} className={`flex ${isMine ? 'justify-end' : 'justify-start'} animate-fade-in-up`}>
                      <div className={`max-w-[80%] p-3.5 rounded-2xl ${
                        isMine
                          ? 'bg-gradient-to-br from-docuflow-secondary to-blue-600 text-white rounded-br-md shadow-md'
                          : 'bg-white border border-slate-100 text-slate-800 rounded-bl-md shadow-sm'
                      }`}>
                        {msg.content && <p className="text-sm leading-relaxed">{msg.content}</p>}

                        {/* Fichiers attachés */}
                        {hasAttachments && (
                          <div className={`${msg.content ? 'mt-2 space-y-1.5' : 'space-y-1.5'}`}>
                            {msg.attachments.map((att, i) => (
                              <a key={i} href={att.url} target="_blank" rel="noopener noreferrer"
                                className={`flex items-center gap-2 p-2 rounded-xl text-xs transition-colors ${
                                  isMine
                                    ? 'bg-white/10 hover:bg-white/20 text-white'
                                    : 'bg-slate-50 hover:bg-slate-100 text-slate-700'
                                }`}>
                                <File size={14} className="flex-shrink-0" />
                                <span className="truncate flex-1">{att.original_name}</span>
                                <Download size={12} className="flex-shrink-0 opacity-60" />
                              </a>
                            ))}
                          </div>
                        )}

                        <div className={`flex items-center gap-1.5 mt-1.5 ${isMine ? 'justify-end' : 'justify-start'}`}>
                          <span className={`text-[10px] ${isMine ? 'text-white/60' : 'text-slate-400'}`}>
                            {formatMessageTime(msg.created_at)}
                          </span>
                          {isMine && (
                            <span className="text-[10px] text-white/40">
                              {msg.is_read ? '✓✓' : '✓'}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
                <div ref={messagesEndRef} />
              </div>

              {/* Input area */}
              <div className="p-4 border-t border-slate-100 bg-white flex-shrink-0">
                {/* Fichiers en attente */}
                {pendingFiles.length > 0 && (
                  <div className="flex flex-wrap gap-2 mb-3">
                    {pendingFiles.map((file, i) => (
                      <div key={i} className="flex items-center gap-2 px-3 py-1.5 bg-slate-50 rounded-xl border border-slate-200 text-xs text-slate-600">
                        <File size={12} />
                        <span className="max-w-[120px] truncate">{file.name}</span>
                        <button onClick={() => removePendingFile(i)} className="text-slate-400 hover:text-red-500 ml-1">
                          <X size={12} />
                        </button>
                      </div>
                    ))}
                    {filesUploading && (
                      <div className="flex items-center gap-2 px-3 py-1.5 bg-blue-50 rounded-xl border border-blue-200 text-xs text-blue-600">
                        <div className="w-3 h-3 border-2 border-blue-300 border-t-blue-600 rounded-full animate-spin" />
                        Upload...
                      </div>
                    )}
                  </div>
                )}

                <div className="flex items-center gap-3">
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    onChange={handleFileSelect}
                    className="hidden"
                    accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg,.gif,.txt,.zip"
                  />
                  <button onClick={() => fileInputRef.current?.click()} disabled={sending || filesUploading}
                    className={`p-3 rounded-xl transition-all flex-shrink-0 ${
                      pendingFiles.length > 0
                        ? 'bg-docuflow-secondary/10 text-docuflow-secondary'
                        : 'text-slate-400 hover:bg-slate-100 hover:text-slate-600'
                    } disabled:opacity-40`}>
                    <Paperclip size={20} />
                  </button>

                  <input
                    ref={chatInputRef}
                    type="text"
                    value={textInput}
                    onChange={(e) => setTextInput(e.target.value)}
                    onKeyDown={handleSendKeyDown}
                    placeholder={pendingFiles.length > 0 ? 'Ajouter un message...' : 'Écrivez votre message...'}
                    disabled={sending || filesUploading}
                    className="flex-1 input-premium disabled:opacity-50"
                  />
                  <button
                    onClick={handleSend}
                    disabled={(!textInput.trim() && pendingFiles.length === 0) || sending || filesUploading}
                    className="p-3.5 bg-gradient-to-br from-docuflow-secondary to-blue-600 text-white rounded-xl hover:shadow-lg hover:shadow-blue-500/25 transition-all disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none flex-shrink-0"
                  >
                    <Send size={20} />
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
};

export default MessagingPanel;
