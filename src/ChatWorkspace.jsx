import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AtSign,
  ArrowUp,
  Check,
  ChevronDown,
  Copy,
  FileText,
  ImagePlus,
  Menu,
  MessageSquare,
  Mic,
  MoreHorizontal,
  Plus,
  Share2,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  X,
} from 'lucide-react';
import { assetUrl, request, statusNames } from './api.js';
import { ImageLightbox } from './components.jsx';
import { insertMentionToken, uniqueMention } from './referenceMentions.js';
import { activateAdjacentThumbnail } from './thumbnailNavigation.js';

const STORAGE_KEY = 'badmark-chat-conversations-v3';
const MAX_CHAT_REFERENCES = 5;

const uid = () => crypto.randomUUID();
const now = () => new Date().toISOString();
const cleanTitle = (value) => value.trim().replace(/\s+/g, ' ').slice(0, 24) || '新对话';
const blankConversation = () => ({
  id: uid(),
  title: '新对话',
  createdAt: now(),
  updatedAt: now(),
  messages: [],
});

function readConversations() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (Array.isArray(saved) && saved.length) return saved;
  } catch {}
  return [blankConversation()];
}

function persistConversations(conversations) {
  const safe = conversations.slice(0, 50).map((conversation) => ({
    ...conversation,
    messages: conversation.messages.slice(-80).map((message) => ({
      ...message,
      attachments: message.attachments?.map(({ localUrl: _localUrl, ...attachment }) => attachment),
    })),
  }));
  localStorage.setItem(STORAGE_KEY, JSON.stringify(safe));
}

const suggestions = [
  '分析当前项目进度并给出下一步建议',
  '使用当前项目的趋势、模特和 Logo 生成 2 款',
  '检查待处理任务和失败原因',
];

function ResultGallery({ results, onPreview, onContentLoad }) {
  const [selected, setSelected] = useState(0);
  const current = results[Math.min(selected, results.length - 1)];
  const previewItems = results
    .filter((result) => result.assetId)
    .map((result, index) => ({
      src: assetUrl(result.assetId),
      title: `生成结果 ${index + 1}`,
    }));
  if (!current?.assetId) return null;
  return (
    <div className="chat-result-gallery">
      <div className="chat-result-main">
        <button
          type="button"
          className="chat-result-main-button"
          aria-label={`放大生成结果 ${selected + 1}`}
          onClick={() =>
            onPreview?.({
              src: assetUrl(current.assetId),
              name: `生成结果 ${selected + 1}`,
              items: previewItems,
              index: selected,
            })
          }
        >
          <img
            src={assetUrl(current.assetId)}
            alt={`生成结果 ${selected + 1}`}
            onLoad={onContentLoad}
          />
        </button>
        <a href={`${assetUrl(current.assetId)}?download=1`} download>
          下载原图
        </a>
      </div>
      {results.length > 1 && (
        <div
          className="chat-result-strip"
          role="region"
          tabIndex={0}
          aria-label="生成结果版本"
          onKeyDown={(event) => activateAdjacentThumbnail(event, event.currentTarget)}
        >
          {results.map((result, index) => (
            <button
              type="button"
              className={index === selected ? 'active' : ''}
              aria-label={`查看生成结果 ${index + 1}`}
              key={`${result.assetId}-${index}`}
              onClick={() => setSelected(index)}
            >
              <img src={assetUrl(result.assetId)} alt="" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ResponseActions({ content }) {
  const [reaction, setReaction] = useState('');
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard?.writeText(content || '');
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };
  return (
    <div className="chat-response-actions">
      <button type="button" aria-label="复制回答" onClick={copy}>
        {copied ? <Check size={15} /> : <Copy size={15} />}
      </button>
      <button
        type="button"
        aria-label="回答有帮助"
        aria-pressed={reaction === 'up'}
        onClick={() => setReaction(reaction === 'up' ? '' : 'up')}
      >
        <ThumbsUp size={15} />
      </button>
      <button
        type="button"
        aria-label="回答需改进"
        aria-pressed={reaction === 'down'}
        onClick={() => setReaction(reaction === 'down' ? '' : 'down')}
      >
        <ThumbsDown size={15} />
      </button>
      <button type="button" aria-label="更多操作">
        <MoreHorizontal size={15} />
      </button>
    </div>
  );
}

function ImageGenerationMotion() {
  return (
    <div className="chat-image-generation" role="status" aria-label="正在生成图片">
      <div className="chat-image-generation-preview" aria-hidden="true">
        <span />
        <Sparkles size={24} />
      </div>
      <div>
        <strong>正在绘制</strong>
        <span>
          <i />
          <i />
          <i />
        </span>
      </div>
    </div>
  );
}

function TaskResponse({ message, task, onNavigate, onRetry, onPreview, onContentLoad }) {
  if (!task)
    return (
      <div className="chat-task-card failed">
        <strong>任务记录暂不可用</strong>
        <p>工作台没有找到这条任务，请刷新后重试。</p>
      </div>
    );
  const active = ['pending', 'running', 'paused'].includes(task.status);
  const moving = ['pending', 'running'].includes(task.status);
  const completed = task.status === 'completed';
  return (
    <div className={`chat-task-card ${task.status}`}>
      <div className="chat-task-heading">
        <span className={active ? 'chat-task-pulse' : ''}>
          {completed ? (
            <Check size={15} />
          ) : task.kind === 'analysis' ? (
            <FileText size={15} />
          ) : (
            <Sparkles size={15} />
          )}
        </span>
        <div>
          <strong>
            {task.kind === 'analysis'
              ? completed
                ? '趋势分析完成'
                : '正在分析趋势资料'
              : completed
                ? '图片生成完成'
                : '正在生成图片'}
          </strong>
          <small>{statusNames[task.status] || task.status}</small>
        </div>
      </div>
      <p>{task.message || message.content}</p>
      {active && (
        <>
          {task.kind !== 'analysis' && moving ? (
            <ImageGenerationMotion />
          ) : (
            <div
              className={`chat-task-motion ${moving ? 'moving' : 'paused'}`}
              role="status"
              aria-label={moving ? '任务正在执行' : '任务已暂停'}
            >
              <span className="chat-task-orbit" aria-hidden="true">
                <i />
                <i />
                <i />
              </span>
              <span>
                <strong>{moving ? '正在执行' : '等待继续'}</strong>
                <small>{task.kind === 'analysis' ? '读取资料 · 提炼方向' : '等待继续生成'}</small>
              </span>
            </div>
          )}
          <div className={`chat-task-progress ${moving ? 'moving' : ''}`}>
            <span
              style={{
                width: `${Math.max(8, ((task.results?.length || 0) / Math.max(1, task.total)) * 100)}%`,
              }}
            />
          </div>
        </>
      )}
      {completed && task.kind === 'analysis' && task.analysis && (
        <div className="chat-analysis-result">
          <h3>{task.analysis.theme}</h3>
          <p>{task.analysis.summary}</p>
          <div className="chat-analysis-tags">
            {task.analysis.keywords?.map((keyword) => (
              <span key={keyword}>{keyword}</span>
            ))}
          </div>
          <div className="chat-color-row">
            {task.analysis.colors?.map((color) => (
              <span
                key={`${color.name}-${color.hex}`}
                title={`${color.name} ${color.hex}`}
                style={{ background: color.hex }}
              />
            ))}
          </div>
        </div>
      )}
      {completed && task.kind !== 'analysis' && (
        <ResultGallery
          results={task.results || []}
          onPreview={onPreview}
          onContentLoad={onContentLoad}
        />
      )}
      {['failed', 'cancelled'].includes(task.status) && (
        <div className="chat-task-actions">
          <button type="button" className="chat-inline-link" onClick={() => onRetry(task.id)}>
            重试任务
          </button>
          <button
            type="button"
            className="chat-inline-link"
            onClick={() => onNavigate(task.kind === 'analysis' ? 'trend' : 'restyle')}
          >
            打开对应工作区处理
          </button>
        </div>
      )}
    </div>
  );
}

function AttachmentList({ attachments = [], onPreview, onContentLoad }) {
  if (!attachments.length) return null;
  const previewItems = attachments
    .filter((attachment) => attachment.type !== 'application/pdf')
    .map((attachment, index) => ({
      src: attachment.localUrl || (attachment.assetId ? assetUrl(attachment.assetId) : ''),
      title: attachment.name || `附件 ${index + 1}`,
    }))
    .filter((item) => item.src);
  return (
    <div className="chat-message-attachments">
      {attachments.map((attachment, index) => {
        const source =
          attachment.localUrl || (attachment.assetId ? assetUrl(attachment.assetId) : '');
        const preview =
          attachment.type === 'application/pdf'
            ? attachment.assetId
              ? `${assetUrl(attachment.assetId)}?preview=1`
              : ''
            : source;
        const label = attachment.name || `附件 ${index + 1}`;
        if (attachment.type === 'application/pdf')
          return (
            <a
              className="chat-attachment-tile document"
              href={source}
              target="_blank"
              rel="noreferrer"
              aria-label={`打开源文件 ${label}`}
              title={label}
              key={`${label}-${index}`}
            >
              {preview ? (
                <img src={preview} alt="" onLoad={onContentLoad} />
              ) : (
                <FileText size={24} />
              )}
              <span>PDF</span>
            </a>
          );
        return (
          <button
            type="button"
            className="chat-attachment-tile"
            aria-label={`放大附件 ${label}`}
            title={label}
            onClick={() =>
              onPreview?.({
                src: source,
                name: label,
                items: previewItems,
                index: previewItems.findIndex((item) => item.src === source),
              })
            }
            key={`${label}-${index}`}
          >
            {preview ? <img src={preview} alt="" onLoad={onContentLoad} /> : <FileText size={24} />}
          </button>
        );
      })}
    </div>
  );
}

export function ChatWorkspace({
  project,
  tasks,
  connected,
  executor,
  onNewProject,
  onNavigate,
  onRefresh,
}) {
  const initialConversations = useMemo(readConversations, []);
  const [conversations, setConversations] = useState(initialConversations);
  const [activeId, setActiveId] = useState(initialConversations[0].id);
  const [draft, setDraft] = useState('');
  const [intent, setIntent] = useState('chat');
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [historyOpen, setHistoryOpen] = useState(false);
  const [listening, setListening] = useState(false);
  const [preview, setPreview] = useState(null);
  const directFileInput = useRef(null);
  const imageInput = useRef(null);
  const trendInput = useRef(null);
  const textareaRef = useRef(null);
  const messageListRef = useRef(null);
  const followOutputRef = useRef(true);
  const active =
    conversations.find((conversation) => conversation.id === activeId) || conversations[0];
  const ordered = useMemo(
    () => [...conversations].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
    [conversations],
  );
  const activeTaskSignature = useMemo(
    () =>
      active.messages
        .filter((message) => message.taskId)
        .map((message) => {
          const task = tasks.find((candidate) => candidate.id === message.taskId);
          return task
            ? `${task.id}:${task.status}:${task.message || ''}:${task.results?.length || 0}:${task.updatedAt || ''}`
            : `${message.taskId}:missing`;
        })
        .join('|'),
    [active.messages, tasks],
  );
  const mentionMatch = draft.match(/(?:^|\s)@([^\s@]*)$/);
  const mentionSuggestions = mentionMatch
    ? files.filter(({ mention }) =>
        mention.toLocaleLowerCase().includes(mentionMatch[1].toLocaleLowerCase()),
      )
    : [];
  const composerPreviewItems = files
    .filter(({ file }) => file.type !== 'application/pdf')
    .map(({ file, localUrl }) => ({ src: localUrl, title: file.name }));
  const aiConnection = !connected
    ? { label: '本机服务已断开', online: false }
    : executor?.checking
      ? { label: '正在检测账号', online: false }
      : executor?.ready
        ? { label: 'AI 服务已就绪', online: true }
        : executor?.authRequired
          ? { label: '需要登录账号', online: false }
          : { label: 'AI 服务不可用', online: false };

  useEffect(() => {
    persistConversations(conversations);
  }, [conversations]);
  useEffect(() => {
    followOutputRef.current = true;
  }, [activeId]);
  useEffect(() => {
    if (!followOutputRef.current) return undefined;
    const frame = window.requestAnimationFrame(() => {
      const list = messageListRef.current;
      if (list) list.scrollTo({ top: list.scrollHeight, behavior: 'auto' });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeId, active.messages.length, activeTaskSignature, busy]);

  const keepBottomIfFollowing = () => {
    if (!followOutputRef.current) return;
    window.requestAnimationFrame(() => {
      const list = messageListRef.current;
      if (list) list.scrollTo({ top: list.scrollHeight, behavior: 'auto' });
    });
  };

  const handleMessageScroll = (event) => {
    const list = event.currentTarget;
    followOutputRef.current = list.scrollHeight - list.scrollTop - list.clientHeight <= 96;
  };

  const updateActive = (transform) => {
    setConversations((current) =>
      current.map((conversation) =>
        conversation.id === activeId
          ? { ...transform(conversation), updatedAt: now() }
          : conversation,
      ),
    );
  };

  const clearFiles = () => {
    files.forEach(({ localUrl }) => URL.revokeObjectURL(localUrl));
    setFiles([]);
  };

  const createConversation = () => {
    const conversation = blankConversation();
    setConversations((current) => [conversation, ...current]);
    setActiveId(conversation.id);
    setDraft('');
    clearFiles();
    setIntent('chat');
    setError('');
    setHistoryOpen(false);
    followOutputRef.current = true;
  };

  const deleteConversation = (id) => {
    setConversations((current) => {
      const remaining = current.filter((conversation) => conversation.id !== id);
      if (remaining.length) {
        if (activeId === id) setActiveId(remaining[0].id);
        return remaining;
      }
      const replacement = blankConversation();
      setActiveId(replacement.id);
      return [replacement];
    });
  };

  const applyPickedFiles = (selected, nextIntent) => {
    if (nextIntent === 'trend') {
      clearFiles();
      setFiles(
        selected.slice(0, 1).map((file) => ({
          file,
          localUrl: URL.createObjectURL(file),
          mention: uniqueMention(file.name),
        })),
      );
      setError(selected.length > 1 ? '趋势分析每次只处理一份资料。' : '');
    } else {
      const current = intent === 'image' ? files : [];
      if (intent !== 'image') files.forEach(({ localUrl }) => URL.revokeObjectURL(localUrl));
      const known = new Set(
        current.map(({ file }) => `${file.name}:${file.size}:${file.lastModified}:${file.type}`),
      );
      const additions = selected.filter((file) => {
        const key = `${file.name}:${file.size}:${file.lastModified}:${file.type}`;
        if (known.has(key)) return false;
        known.add(key);
        return true;
      });
      const accepted = additions.slice(0, Math.max(0, MAX_CHAT_REFERENCES - current.length));
      const usedMentions = current.map(({ mention }) => mention);
      setFiles([
        ...current,
        ...accepted.map((file) => {
          const mention = uniqueMention(file.name, usedMentions);
          usedMentions.push(mention);
          return { file, localUrl: URL.createObjectURL(file), mention };
        }),
      ]);
      setError(
        additions.length > accepted.length
          ? `每次最多使用 ${MAX_CHAT_REFERENCES} 张参考图，已保留前 ${MAX_CHAT_REFERENCES} 张。`
          : '',
      );
    }
    setIntent(nextIntent);
  };

  const pickFiles = (event, nextIntent) => {
    applyPickedFiles(Array.from(event.target.files || []), nextIntent);
    event.target.value = '';
  };

  const pickDirectFiles = (event) => {
    const selected = Array.from(event.target.files || []);
    if (!selected.length) return;
    const documents = selected.filter(
      (file) => file.type === 'application/pdf' || /\.pdf$/i.test(file.name),
    );
    if (documents.length && selected.length > 1) {
      setError('趋势 PDF 需要单独选择；参考图片可以一次添加多张。');
      event.target.value = '';
      return;
    }
    applyPickedFiles(selected, documents.length ? 'trend' : 'image');
    event.target.value = '';
  };

  const removeFile = (index) => {
    setFiles((current) => {
      URL.revokeObjectURL(current[index]?.localUrl);
      const remaining = current.filter((_, candidate) => candidate !== index);
      if (!remaining.length) setIntent('chat');
      return remaining;
    });
  };

  const insertMention = (mention) => {
    setDraft((current) => insertMentionToken(current, mention));
    window.requestAnimationFrame(() => textareaRef.current?.focus());
  };

  const addMessage = (message) => {
    updateActive((conversation) => ({
      ...conversation,
      title: conversation.messages.some((item) => item.role === 'user')
        ? conversation.title
        : cleanTitle(message.content),
      messages: [...conversation.messages, message],
    }));
  };

  const replaceMessage = (id, patch) => {
    updateActive((conversation) => ({
      ...conversation,
      messages: conversation.messages.map((message) =>
        message.id === id ? { ...message, ...patch } : message,
      ),
    }));
  };

  const executeChatAction = async (history) =>
    request('/chat/actions', {
      method: 'POST',
      body: {
        projectId: project?.id || null,
        messages: history.slice(-40).map(({ role, content: text, taskId }) => ({
          role,
          content: text,
          ...(taskId ? { taskId } : {}),
        })),
      },
    });

  const retryTask = async (taskId) => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await executeChatAction([{ role: 'user', content: '重试这个任务', taskId }]);
      followOutputRef.current = true;
      await onRefresh?.();
    } catch (caught) {
      setError(caught.message);
    } finally {
      setBusy(false);
    }
  };

  const send = async (event) => {
    event?.preventDefault();
    const content = draft.trim();
    if ((!content && intent === 'chat') || busy) return;
    if (!connected) {
      setError('本机服务已断开，恢复连接后再试。');
      return;
    }
    if (!executor?.ready) {
      setError(
        executor?.authRequired
          ? '请先完成账号登录，再运行对话或生成任务。'
          : executor?.message || 'AI 服务尚未就绪，请重新检测连接。',
      );
      return;
    }
    if (intent === 'image' && executor?.imageGeneration === false) {
      setError(executor?.message || '当前 AI 服务不支持图片生成，请检查连接后重试。');
      return;
    }
    if (intent !== 'chat' && !files.length) {
      setError(intent === 'trend' ? '请先添加一份趋势 PDF 或图片。' : '请先添加至少一张参考图。');
      return;
    }
    if (intent === 'image' && !project) {
      setError('请先选择或创建一个项目，再开始图片生成。');
      return;
    }
    const userId = uid();
    followOutputRef.current = true;
    const localAttachments = files.map(({ file, localUrl, mention }) => ({
      name: file.name,
      type: file.type,
      localUrl,
      mention,
    }));
    const userMessage = {
      id: userId,
      role: 'user',
      content: content || (intent === 'trend' ? '分析这份趋势资料' : '根据参考图生成新图片'),
      attachments: localAttachments,
      createdAt: now(),
    };
    const history = [...active.messages, userMessage];
    addMessage(userMessage);
    setDraft('');
    setBusy(true);
    setError('');
    try {
      if (intent === 'chat') {
        const action = await executeChatAction(history);
        if (action.handled) {
          addMessage({
            id: uid(),
            role: 'assistant',
            content: action.reply,
            taskId: action.task.id,
            createdAt: now(),
          });
        } else {
          const response = await request('/chat', {
            method: 'POST',
            body: {
              projectId: project?.id || null,
              messages: history
                .filter((message) => !message.taskId && message.content)
                .slice(-20)
                .map(({ role, content: text }) => ({ role, content: text })),
            },
          });
          addMessage({ id: uid(), role: 'assistant', content: response.reply, createdAt: now() });
        }
      } else if (intent === 'trend') {
        const form = new FormData();
        form.append('file', files[0].file);
        form.append('title', files[0].file.name.replace(/\.[^.]+$/, ''));
        const uploaded = await request('/library/trends', { method: 'POST', form });
        replaceMessage(userId, {
          attachments: [
            {
              name: files[0].file.name,
              type: files[0].file.type,
              assetId: uploaded.item.assetId,
              mention: files[0].mention,
            },
          ],
        });
        await request('/executor/control', {
          method: 'POST',
          body: { action: 'start-task', taskId: uploaded.task.id },
        });
        addMessage({
          id: uid(),
          role: 'assistant',
          content: '趋势资料已接收，正在提炼主题、色彩、廓形与工艺方向。',
          taskId: uploaded.task.id,
          createdAt: now(),
        });
      } else {
        const form = new FormData();
        files.forEach(({ file }) => form.append('files', file));
        const uploaded = await request(`/projects/${project.id}/refine-references`, {
          method: 'POST',
          form,
        });
        replaceMessage(userId, {
          attachments: files.map(({ file, mention }, index) => ({
            name: file.name,
            type: file.type,
            assetId: uploaded.assets[index].id,
            mention,
          })),
        });
        const task = await request(`/projects/${project.id}/tasks`, {
          method: 'POST',
          body: {
            kind: 'restyle',
            channel: 'chat',
            sourceAssetId: uploaded.assets[0].id,
            referenceAssetIds: uploaded.assets.slice(1).map((asset) => asset.id),
            referenceLabels: files.slice(1).map(({ mention }) => `@${mention}`),
            instruction: content || '保持主体风格，结合参考图生成一张完整、自然的服装设计图。',
            background: 'scene',
          },
        });
        await request('/executor/control', {
          method: 'POST',
          body: { action: 'start-task', taskId: task.id },
        });
        addMessage({
          id: uid(),
          role: 'assistant',
          content: '参考图与提示词已接收，正在生成并检查图片。',
          taskId: task.id,
          createdAt: now(),
        });
      }
      files.forEach(({ localUrl }) => URL.revokeObjectURL(localUrl));
      setFiles([]);
      setIntent('chat');
      await onRefresh?.();
    } catch (caught) {
      setError(caught.message);
      addMessage({
        id: uid(),
        role: 'assistant',
        content: `未能执行：${caught.message}`,
        createdAt: now(),
      });
    } finally {
      setBusy(false);
    }
  };

  const startVoice = () => {
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) {
      setError('当前浏览器不支持语音输入。');
      return;
    }
    const recognition = new Recognition();
    recognition.lang = 'zh-CN';
    recognition.interimResults = false;
    recognition.onstart = () => setListening(true);
    recognition.onend = () => setListening(false);
    recognition.onerror = () => setError('没有识别到语音，请重试。');
    recognition.onresult = (result) =>
      setDraft((current) => `${current}${current ? ' ' : ''}${result.results[0][0].transcript}`);
    recognition.start();
  };

  const shareConversation = async () => {
    const text = active.messages
      .map((message) => `${message.role === 'user' ? '我' : '红人馆AI'}：${message.content}`)
      .join('\n\n');
    await navigator.clipboard?.writeText(text);
  };

  return (
    <section className="chat-workspace chat-native" aria-label="Chat模式">
      <aside className={`chat-history-panel ${historyOpen ? 'open' : ''}`}>
        <div className="chat-history-head">
          <strong>Chat</strong>
          <button type="button" aria-label="关闭会话列表" onClick={() => setHistoryOpen(false)}>
            <X size={17} />
          </button>
        </div>
        <button type="button" className="chat-new" onClick={createConversation}>
          <Plus size={17} /> 新对话
        </button>
        <p>最近</p>
        <div className="chat-history-list">
          {ordered.map((conversation) => (
            <div className={conversation.id === activeId ? 'active' : ''} key={conversation.id}>
              <button
                type="button"
                onClick={() => {
                  followOutputRef.current = true;
                  setActiveId(conversation.id);
                  setHistoryOpen(false);
                }}
              >
                <MessageSquare size={14} />
                <span>{conversation.title}</span>
              </button>
              <button
                type="button"
                className="chat-delete"
                aria-label={`删除对话 ${conversation.title}`}
                onClick={() => deleteConversation(conversation.id)}
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>
      </aside>

      <div className="chat-conversation">
        <header className="chat-native-header">
          <button
            type="button"
            className="chat-history-toggle"
            aria-label="打开会话列表"
            onClick={() => setHistoryOpen(true)}
          >
            <Menu size={18} />
          </button>
          <div>
            <strong>Chat模式</strong>
            <span className={aiConnection.online ? 'online' : ''}>{aiConnection.label}</span>
          </div>
          <button type="button" className="chat-project-context" title="当前项目">
            {project?.name || '未选择项目'} <ChevronDown size={14} />
          </button>
          <button type="button" className="chat-share" onClick={shareConversation}>
            <Share2 size={15} /> 分享
          </button>
        </header>

        <div
          ref={messageListRef}
          className={`chat-native-messages ${active.messages.length ? '' : 'empty'}`}
          aria-live="polite"
          onScroll={handleMessageScroll}
        >
          {!active.messages.length && (
            <div className="chat-welcome">
              <div>
                <Sparkles size={25} />
              </div>
              <h1>今天想设计什么？</h1>
              <p>可以直接对话，也可以添加参考图生成服装图片，或上传趋势资料进行分析。</p>
              <div className="chat-welcome-actions">
                <button type="button" onClick={() => imageInput.current?.click()}>
                  <ImagePlus size={16} /> 参考图生成
                </button>
                <button type="button" onClick={() => trendInput.current?.click()}>
                  <FileText size={16} /> 趋势分析
                </button>
                {suggestions.slice(0, 2).map((suggestion) => (
                  <button type="button" key={suggestion} onClick={() => setDraft(suggestion)}>
                    <Sparkles size={16} /> {suggestion}
                  </button>
                ))}
              </div>
              {!project && (
                <button type="button" className="chat-create-project" onClick={onNewProject}>
                  创建项目并开始设计
                </button>
              )}
            </div>
          )}
          {active.messages.map((message) => {
            const task = message.taskId
              ? tasks.find((candidate) => candidate.id === message.taskId)
              : null;
            return (
              <article className={`chat-native-message ${message.role}`} key={message.id}>
                {message.role === 'user' ? (
                  <div className="chat-user-message">
                    <AttachmentList
                      attachments={message.attachments}
                      onPreview={setPreview}
                      onContentLoad={keepBottomIfFollowing}
                    />
                    <p>{message.content}</p>
                  </div>
                ) : (
                  <div className="chat-assistant-message">
                    {message.taskId ? (
                      <TaskResponse
                        message={message}
                        task={task}
                        onNavigate={onNavigate}
                        onRetry={retryTask}
                        onPreview={setPreview}
                        onContentLoad={keepBottomIfFollowing}
                      />
                    ) : (
                      <p>{message.content}</p>
                    )}
                    <ResponseActions content={message.content} />
                  </div>
                )}
              </article>
            );
          })}
          {busy && (
            <article className="chat-native-message assistant">
              <div className="chat-assistant-message chat-working">
                <span /> <span /> <span />
              </div>
            </article>
          )}
        </div>

        <div className="chat-native-composer-wrap">
          {error && (
            <p className="chat-native-error" role="alert">
              {error}
            </p>
          )}
          <div className={`chat-composer-surface ${files.length ? 'has-files' : ''}`}>
            {files.length > 0 && (
              <div className="chat-compose-context">
                <div className="chat-compose-context-head">
                  <span className={`chat-intent ${intent}`}>
                    {intent === 'image'
                      ? `参考图片 ${files.length} / ${MAX_CHAT_REFERENCES}`
                      : '趋势资料'}
                  </span>
                  <small>{intent === 'image' ? '点击预览 · @ 调用' : '点击打开源文件'}</small>
                </div>
                <div className="chat-compose-files">
                  {files.map(({ file, localUrl, mention }, index) => (
                    <article
                      className="chat-compose-file"
                      key={`${file.name}-${index}`}
                      title={file.name}
                    >
                      {file.type === 'application/pdf' ? (
                        <a
                          className="chat-compose-preview document"
                          href={localUrl}
                          target="_blank"
                          rel="noreferrer"
                          aria-label={`打开源文件 ${file.name}`}
                        >
                          <FileText size={22} />
                          <span>PDF</span>
                        </a>
                      ) : (
                        <button
                          type="button"
                          className="chat-compose-preview"
                          aria-label={`放大参考图 ${file.name}`}
                          onClick={() =>
                            setPreview({
                              src: localUrl,
                              name: file.name,
                              items: composerPreviewItems,
                              index: composerPreviewItems.findIndex(
                                (item) => item.src === localUrl,
                              ),
                            })
                          }
                        >
                          <img src={localUrl} alt="" />
                        </button>
                      )}
                      <button
                        type="button"
                        className="chat-compose-mention"
                        aria-label={`在提示词中调用 @${mention}`}
                        title={`@${mention}`}
                        onClick={() => insertMention(mention)}
                      >
                        <AtSign size={12} />
                      </button>
                      <button
                        type="button"
                        className="chat-compose-remove"
                        aria-label={`移除 ${file.name}`}
                        onClick={() => removeFile(index)}
                      >
                        <X size={12} />
                      </button>
                    </article>
                  ))}
                  {intent === 'image' && files.length < MAX_CHAT_REFERENCES && (
                    <button
                      type="button"
                      className="chat-compose-add"
                      aria-label="继续添加参考图"
                      onClick={() => imageInput.current?.click()}
                    >
                      <ImagePlus size={16} />
                      <span>添加</span>
                    </button>
                  )}
                </div>
              </div>
            )}
            <form className="chat-native-composer" onSubmit={send}>
              <button
                type="button"
                className="chat-file-trigger"
                aria-label="添加参考资料"
                title="添加图片或 PDF"
                onClick={() => directFileInput.current?.click()}
              >
                <Plus size={20} />
              </button>
              <input
                ref={directFileInput}
                className="chat-direct-file-input"
                type="file"
                accept=".pdf,image/*"
                multiple
                hidden
                onChange={pickDirectFiles}
              />
              <input
                ref={imageInput}
                className="chat-image-input"
                type="file"
                accept="image/*"
                multiple
                hidden
                onChange={(event) => pickFiles(event, 'image')}
              />
              <input
                ref={trendInput}
                className="chat-trend-input"
                type="file"
                accept=".pdf,image/*"
                hidden
                onChange={(event) => pickFiles(event, 'trend')}
              />
              <div className="chat-input-column">
                {mentionSuggestions.length > 0 && (
                  <div className="chat-mention-menu" role="listbox" aria-label="调用参考资料">
                    {mentionSuggestions.map(({ file, localUrl, mention }) => (
                      <button
                        type="button"
                        role="option"
                        aria-selected="false"
                        key={mention}
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => insertMention(mention)}
                      >
                        {file.type === 'application/pdf' ? (
                          <FileText size={15} />
                        ) : (
                          <img src={localUrl} alt="" />
                        )}
                        <span>@{mention}</span>
                      </button>
                    ))}
                  </div>
                )}
                <textarea
                  ref={textareaRef}
                  aria-label="发送消息"
                  rows={1}
                  value={draft}
                  disabled={busy}
                  placeholder={
                    intent === 'image'
                      ? '描述希望如何生成或修改图片'
                      : intent === 'trend'
                        ? '输入希望重点分析的方向'
                        : '输入消息或直接安排设计任务'
                  }
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault();
                      send(event);
                    }
                  }}
                />
              </div>
              <button
                type="button"
                className={listening ? 'listening' : ''}
                aria-label="语音输入"
                onClick={startVoice}
              >
                <Mic size={19} />
              </button>
              <button
                type="submit"
                className="chat-native-send"
                aria-label="发送消息"
                disabled={busy || (!draft.trim() && intent === 'chat')}
              >
                <ArrowUp size={18} />
              </button>
            </form>
          </div>
          <small>AI 可能会出错，请检查重要信息。工作台数据不会用于训练模型。</small>
        </div>
      </div>
      {historyOpen && (
        <button
          type="button"
          className="chat-history-shade"
          aria-label="关闭会话列表"
          onClick={() => setHistoryOpen(false)}
        />
      )}
      {preview?.src && (
        <ImageLightbox
          src={preview.src}
          title={preview.name || '图片预览'}
          items={preview.items}
          initialIndex={preview.index}
          onClose={() => setPreview(null)}
        />
      )}
    </section>
  );
}
