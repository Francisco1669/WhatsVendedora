const TOKEN_KEY = "testezap_owner_token";
const RANGE_MS = {
    "24h": 24 * 60 * 60 * 1000,
    "7d": 7 * 24 * 60 * 60 * 1000,
    all: null,
};

const state = {
    token: "",
    user: null,
    sellers: [],
    origins: [],
    audits: [],
    messages: [],
    conversations: [],
    selectedInstanceId: null,
    selectedConversationId: null,
    selectedOriginTag: null,
    selectedRange: "24h",
    sellerFormMode: "create",
    editingInstanceId: null,
};

const dom = {};

document.addEventListener("DOMContentLoaded", () => {
    cacheElements();
    bindEvents();
    setSellerFormCreateMode();
    hideQrCard();
    bootstrap();
});

function cacheElements() {
    dom.loginView = document.getElementById("loginView");
    dom.dashboardView = document.getElementById("dashboardView");
    dom.loginForm = document.getElementById("loginForm");
    dom.emailInput = document.getElementById("emailInput");
    dom.passwordInput = document.getElementById("passwordInput");
    dom.loginButton = document.getElementById("loginButton");
    dom.loginError = document.getElementById("loginError");

    dom.refreshAllButton = document.getElementById("refreshAllButton");
    dom.logoutButton = document.getElementById("logoutButton");
    dom.userBadge = document.getElementById("userBadge");

    dom.sellerForm = document.getElementById("sellerForm");
    dom.sellerFormTitle = document.getElementById("sellerFormTitle");
    dom.sellerFormModeTag = document.getElementById("sellerFormModeTag");
    dom.sellerIdInput = document.getElementById("sellerIdInput");
    dom.sellerEvolutionInput = document.getElementById("sellerEvolutionInput");
    dom.sellerLabelInput = document.getElementById("sellerLabelInput");
    dom.sellerPhoneInput = document.getElementById("sellerPhoneInput");
    dom.sellerActiveInput = document.getElementById("sellerActiveInput");
    dom.sellerProvisionInput = document.getElementById("sellerProvisionInput");
    dom.sellerResetButton = document.getElementById("sellerResetButton");
    dom.sellerSaveButton = document.getElementById("sellerSaveButton");

    dom.sellersCounter = document.getElementById("sellersCounter");
    dom.sellerSearchInput = document.getElementById("sellerSearchInput");
    dom.sellerList = document.getElementById("sellerList");

    dom.qrCard = document.getElementById("qrCard");
    dom.qrCardTitle = document.getElementById("qrCardTitle");
    dom.qrCardMeta = document.getElementById("qrCardMeta");
    dom.qrImage = document.getElementById("qrImage");
    dom.qrRaw = document.getElementById("qrRaw");
    dom.qrCloseButton = document.getElementById("qrCloseButton");

    dom.conversationTitle = document.getElementById("conversationTitle");
    dom.conversationMeta = document.getElementById("conversationMeta");
    dom.threadsCounter = document.getElementById("threadsCounter");
    dom.threadsList = document.getElementById("threadsList");
    dom.messagesFeed = document.getElementById("messagesFeed");
    dom.recipientInput = document.getElementById("recipientInput");
    dom.messageInput = document.getElementById("messageInput");
    dom.sendForm = document.getElementById("sendForm");
    dom.sendButton = document.getElementById("sendButton");
    dom.rangeButtons = Array.from(document.querySelectorAll(".range-button"));

    dom.statActiveSellers = document.getElementById("statActiveSellers");
    dom.statInbound24h = document.getElementById("statInbound24h");
    dom.statOrigins = document.getElementById("statOrigins");
    dom.originsCounter = document.getElementById("originsCounter");
    dom.originsList = document.getElementById("originsList");
    dom.auditCounter = document.getElementById("auditCounter");
    dom.auditList = document.getElementById("auditList");

    dom.toastArea = document.getElementById("toastArea");
}

function bindEvents() {
    dom.loginForm.addEventListener("submit", onLoginSubmit);
    dom.refreshAllButton.addEventListener("click", () => refreshDashboard({ preserveSelection: true }));
    dom.logoutButton.addEventListener("click", onLogout);

    dom.sellerForm.addEventListener("submit", onSellerFormSubmit);
    dom.sellerResetButton.addEventListener("click", onSellerFormReset);
    dom.sellerSearchInput.addEventListener("input", renderSellerList);
    dom.sellerList.addEventListener("click", onSellerItemClick);
    dom.threadsList.addEventListener("click", onThreadItemClick);
    dom.qrCloseButton.addEventListener("click", hideQrCard);

    dom.sendForm.addEventListener("submit", onSendSubmit);
    dom.rangeButtons.forEach((button) => {
        button.addEventListener("click", () => onRangeSelected(button.dataset.range));
    });
}

async function bootstrap() {
    const storedToken = localStorage.getItem(TOKEN_KEY);
    if (!storedToken) {
        showLogin();
        return;
    }

    state.token = storedToken;

    try {
        const me = await apiRequest("/auth/me");
        state.user = me.user;
        showDashboard();
        await refreshDashboard({ preserveSelection: true });
    } catch (error) {
        clearSession();
        showLogin();
        showToast("Sessao expirada. Entre novamente.", "error");
    }
}

async function onLoginSubmit(event) {
    event.preventDefault();

    const email = dom.emailInput.value.trim();
    const password = dom.passwordInput.value;
    if (!email || !password) {
        setLoginError("Preencha email e senha.");
        return;
    }

    setLoginLoading(true);
    setLoginError("");

    try {
        const payload = await apiRequest("/auth/login", {
            method: "POST",
            auth: false,
            body: { email, password },
        });

        state.token = payload.accessToken;
        state.user = payload.user;
        localStorage.setItem(TOKEN_KEY, payload.accessToken);

        showDashboard();
        await refreshDashboard({ preserveSelection: true });
        showToast(`Bem-vinda, ${payload.user.name}!`);
    } catch (error) {
        setLoginError(error.message || "Nao foi possivel entrar.");
    } finally {
        setLoginLoading(false);
    }
}

function onLogout() {
    clearSession();
    showLogin();
    showToast("Sessao encerrada.");
}

async function refreshDashboard({ preserveSelection }) {
    setDashboardLoading(true);

    try {
        const [sellerSummary, origins, audits] = await Promise.all([
            apiRequest("/api/seller-summary"),
            apiRequest("/api/messages/origins"),
            apiRequest("/api/audit?limit=20"),
        ]);

        state.sellers = sellerSummary.data || [];
        state.origins = origins.data || [];
        state.audits = audits.data || [];

        renderStats();
        renderOrigins();
        renderAudit();

        if (!preserveSelection || !state.sellers.some((seller) => seller.instanceId === state.selectedInstanceId)) {
            state.selectedInstanceId = state.sellers[0] ? state.sellers[0].instanceId : null;
        }

        renderSellerList();

        if (state.selectedInstanceId) {
            await loadConversationsForInstance(state.selectedInstanceId, { preserveConversation: true });
        } else {
            state.messages = [];
            state.conversations = [];
            state.selectedConversationId = null;
            renderThreads();
            renderEmptyConversation("Nenhuma instancia cadastrada.");
            setComposerAvailability(null);
        }
    } catch (error) {
        handleApiError(error);
    } finally {
        setDashboardLoading(false);
    }
}

function renderStats() {
    const activeCount = state.sellers.filter((item) => item.active).length;
    const inbound24h = state.sellers.reduce((sum, item) => sum + Number(item.inboundLast24h || 0), 0);

    dom.statActiveSellers.textContent = String(activeCount);
    dom.statInbound24h.textContent = String(inbound24h);
    dom.statOrigins.textContent = String(state.origins.length);
    dom.originsCounter.textContent = String(state.origins.length);
    dom.auditCounter.textContent = String(state.audits.length);
}

function renderSellerList() {
    const searchText = dom.sellerSearchInput.value.trim().toLowerCase();
    const sellers = state.sellers.filter((item) => {
        if (!searchText) {
            return true;
        }

        const haystack = [item.instanceId, item.sellerLabel, item.phoneNumber, item.evolutionInstance]
            .filter(Boolean)
            .join(" ")
            .toLowerCase();

        return haystack.includes(searchText);
    });

    dom.sellersCounter.textContent = String(sellers.length);

    if (sellers.length === 0) {
        dom.sellerList.innerHTML = '<div class="empty-state">Nenhuma vendedora encontrada.</div>';
        return;
    }

    dom.sellerList.innerHTML = sellers
        .map((item, index) => {
            const isSelected = item.instanceId === state.selectedInstanceId;
            const statusClass = getStatusClass(item.connectionStatus);
            const sellerClass = ["seller-item", isSelected ? "active" : "", item.active ? "" : "inactive"]
                .filter(Boolean)
                .join(" ");
            const connectDisabled = item.active ? "" : "disabled";

            return `
        <article class="${sellerClass}" style="--order:${index + 1};">
          <button
            type="button"
            class="seller-select"
            data-select-instance-id="${escapeHtml(item.instanceId)}"
          >
            <div class="seller-line">
              <span class="seller-name">${escapeHtml(item.sellerLabel || item.instanceId)}</span>
              <span class="chip">${Number(item.totalInbound || 0)}</span>
            </div>
            <div class="seller-line">
              <span class="seller-sub">${escapeHtml(item.phoneNumber || "-")}</span>
              <span class="status-dot ${statusClass}">${escapeHtml(item.connectionStatus || "unknown")}</span>
            </div>
          </button>
          <div class="seller-actions">
            <button class="btn btn-ghost btn-small" type="button" data-action="connect" data-instance-id="${escapeHtml(item.instanceId)}" ${connectDisabled}>Conectar</button>
            <button class="btn btn-ghost btn-small" type="button" data-action="edit" data-instance-id="${escapeHtml(item.instanceId)}">Editar</button>
                        <button class="btn btn-danger btn-small" type="button" data-action="delete" data-instance-id="${escapeHtml(item.instanceId)}">Excluir</button>
          </div>
        </article>
      `;
        })
        .join("");
}

function renderOrigins() {
    if (!state.origins.length) {
        dom.originsList.innerHTML = '<div class="empty-state">Sem mensagens recebidas ainda.</div>';
        return;
    }

    const topOrigins = state.origins.slice(0, 8);
    dom.originsList.innerHTML = topOrigins
        .map((item) => {
            return `
        <div class="compact-item">
          <span class="compact-item-title">${escapeHtml(item.instanceLabel || item.instanceId || "Instancia")}</span>
          <span class="compact-item-sub">${escapeHtml(item.originPhone || "-")} | ${Number(item.totalMessages || 0)} mensagens</span>
          <span class="compact-item-sub">Ultima: ${formatDateTime(item.lastMessageAt)}</span>
        </div>
      `;
        })
        .join("");
}

function renderAudit() {
    if (!state.audits.length) {
        dom.auditList.innerHTML = '<div class="empty-state">Sem eventos de auditoria.</div>';
        return;
    }

    dom.auditList.innerHTML = state.audits
        .slice(0, 12)
        .map((item) => {
            const actor = item.adminUserName || "sistema";
            const target = item.instanceId ? ` | ${item.instanceId}` : "";
            return `
        <div class="compact-item">
          <span class="compact-item-title">${escapeHtml(item.action)}</span>
          <span class="compact-item-sub">${escapeHtml(actor)}${escapeHtml(target)}</span>
          <span class="compact-item-sub">${formatDateTime(item.createdAt)}</span>
        </div>
      `;
        })
        .join("");
}

async function onSellerItemClick(event) {
    const actionButton = event.target.closest("[data-action][data-instance-id]");
    if (actionButton) {
        const action = actionButton.getAttribute("data-action");
        const instanceId = actionButton.getAttribute("data-instance-id");
        if (action && instanceId) {
            await handleSellerAction(action, instanceId);
        }
        return;
    }

    const selectButton = event.target.closest("[data-select-instance-id]");
    if (!selectButton) {
        return;
    }

    const instanceId = selectButton.getAttribute("data-select-instance-id");
    if (!instanceId || instanceId === state.selectedInstanceId) {
        return;
    }

    await loadConversationsForInstance(instanceId, { preserveConversation: false });
}

async function handleSellerAction(action, instanceId) {
    if (action === "edit") {
        startSellerEdit(instanceId);
        return;
    }

    if (action === "connect") {
        await requestSellerQr(instanceId);
        return;
    }

    if (action === "delete") {
        await deleteSeller(instanceId);
    }
}

function startSellerEdit(instanceId) {
    const seller = getSellerById(instanceId);
    if (!seller) {
        showToast("Vendedora nao encontrada.", "error");
        return;
    }

    state.sellerFormMode = "edit";
    state.editingInstanceId = instanceId;

    dom.sellerIdInput.value = seller.instanceId || "";
    dom.sellerIdInput.disabled = true;
    dom.sellerEvolutionInput.value = seller.evolutionInstance || "";
    dom.sellerLabelInput.value = seller.sellerLabel || "";
    dom.sellerPhoneInput.value = seller.phoneNumber || "";
    dom.sellerActiveInput.checked = Boolean(seller.active);
    dom.sellerProvisionInput.checked = false;
    dom.sellerProvisionInput.disabled = true;

    dom.sellerFormTitle.textContent = `Editar ${seller.sellerLabel || seller.instanceId}`;
    dom.sellerFormModeTag.textContent = "Edicao";
    dom.sellerSaveButton.textContent = "Salvar alteracoes";
    dom.sellerResetButton.textContent = "Cancelar";
}

async function deleteSeller(instanceId) {
    const seller = getSellerById(instanceId);
    const label = seller?.sellerLabel || instanceId;
    const confirmed = window.confirm(
        `Excluir permanentemente a vendedora ${label}? Essa acao remove a instancia e o historico relacionado.`
    );
    if (!confirmed) {
        return;
    }

    try {
        await apiRequest(`/api/instances/${encodeURIComponent(instanceId)}`, {
            method: "DELETE",
        });
        showToast("Vendedora excluida com sucesso.");

        if (state.editingInstanceId === instanceId) {
            setSellerFormCreateMode();
        }

        if (state.selectedInstanceId === instanceId) {
            state.selectedInstanceId = null;
            state.selectedConversationId = null;
        }

        hideQrCard();

        await refreshDashboard({ preserveSelection: false });
    } catch (error) {
        handleApiError(error);
    }
}

async function requestSellerQr(instanceId) {
    const seller = getSellerById(instanceId);
    if (!seller) {
        showToast("Vendedora nao encontrada.", "error");
        return;
    }

    if (!seller.active) {
        showToast("Ative a instancia antes de conectar.", "error");
        return;
    }

    dom.qrCardTitle.textContent = `Conectar ${seller.sellerLabel || seller.instanceId}`;
    dom.qrCardMeta.textContent = "Gerando QR code...";
    dom.qrImage.classList.add("hidden");
    dom.qrRaw.classList.add("hidden");
    dom.qrCard.classList.remove("hidden");

    try {
        const payload = await apiRequest(`/api/instances/${encodeURIComponent(instanceId)}/connect`, {
            method: "POST",
        });

        const qrPayload = payload?.data?.qrData ?? payload?.qrData ?? payload;
        showQrCard(instanceId, qrPayload);
        showToast("QR atualizado. Escaneie no celular da vendedora.");
    } catch (error) {
        handleApiError(error);
    }
}

function showQrCard(instanceId, qrPayload) {
    const seller = getSellerById(instanceId);
    const label = seller?.sellerLabel || instanceId;
    const qr = resolveQrDisplayData(qrPayload);

    dom.qrCardTitle.textContent = `Conectar ${label}`;
    dom.qrCardMeta.textContent = `Instancia ${instanceId}: abra o WhatsApp da vendedora e escaneie o QR.`;

    if (qr.imageSrc) {
        dom.qrImage.src = qr.imageSrc;
        dom.qrImage.classList.remove("hidden");
    } else {
        dom.qrImage.removeAttribute("src");
        dom.qrImage.classList.add("hidden");
    }

    if (qr.rawText) {
        dom.qrRaw.textContent = qr.rawText;
        dom.qrRaw.classList.remove("hidden");
    } else {
        dom.qrRaw.textContent = "";
        dom.qrRaw.classList.add("hidden");
    }

    dom.qrCard.classList.remove("hidden");
}

function hideQrCard() {
    dom.qrCard.classList.add("hidden");
    dom.qrCardMeta.textContent = "";
    dom.qrImage.removeAttribute("src");
    dom.qrImage.classList.add("hidden");
    dom.qrRaw.textContent = "";
    dom.qrRaw.classList.add("hidden");
}

function resolveQrDisplayData(qrPayload) {
    if (!qrPayload) {
        return { imageSrc: null, rawText: "" };
    }

    if (typeof qrPayload === "string") {
        const text = qrPayload.trim();
        return {
            imageSrc: toQrImageSrc(text),
            rawText: text,
        };
    }

    if (typeof qrPayload === "object") {
        if (Number(qrPayload.count || 0) === 0) {
            return {
                imageSrc: null,
                rawText: `A Evolution ainda nao devolveu o QR por HTTP.\nSe isso persistir, abra o manager em ${getEvolutionManagerUrl()} e conecte a instancia por la uma vez.`,
            };
        }

        const candidates = [
            qrPayload.base64,
            qrPayload.qr,
            qrPayload.qrcode,
            qrPayload.qrCode,
            qrPayload.code,
            qrPayload.pairingCode,
            qrPayload.data,
            qrPayload.data?.base64,
            qrPayload.data?.qr,
            qrPayload.data?.qrcode,
            qrPayload.data?.qrCode,
            qrPayload.data?.code,
            qrPayload.data?.pairingCode,
        ];
        const stringCandidate = candidates.find((value) => typeof value === "string" && value.trim());

        return {
            imageSrc: toQrImageSrc(stringCandidate || ""),
            rawText: JSON.stringify(qrPayload, null, 2),
        };
    }

    return {
        imageSrc: null,
        rawText: String(qrPayload),
    };
}

function getEvolutionManagerUrl() {
    return `${window.location.protocol}//${window.location.hostname}:8080/manager`;
}

function toQrImageSrc(value) {
    const text = String(value || "").trim();
    if (!text) {
        return null;
    }

    if (text.startsWith("data:image/")) {
        return text;
    }

    if (text.startsWith("http://") || text.startsWith("https://")) {
        return text;
    }

    if (looksLikeBase64(text)) {
        return `data:image/png;base64,${text.replace(/\s+/g, "")}`;
    }

    return null;
}

function looksLikeBase64(value) {
    const cleaned = String(value || "").replace(/\s+/g, "");
    if (cleaned.length < 120) {
        return false;
    }

    return /^[A-Za-z0-9+/=]+$/.test(cleaned);
}

function onSellerFormReset() {
    setSellerFormCreateMode();
}

function setSellerFormCreateMode() {
    state.sellerFormMode = "create";
    state.editingInstanceId = null;

    dom.sellerForm.reset();
    dom.sellerIdInput.disabled = false;
    dom.sellerProvisionInput.disabled = false;
    dom.sellerActiveInput.checked = true;
    dom.sellerProvisionInput.checked = true;

    dom.sellerFormTitle.textContent = "Nova vendedora";
    dom.sellerFormModeTag.textContent = "Cadastro";
    dom.sellerSaveButton.textContent = "Cadastrar vendedora";
    dom.sellerResetButton.textContent = "Limpar";
}

async function onSellerFormSubmit(event) {
    event.preventDefault();

    const label = dom.sellerLabelInput.value.trim();
    const phoneNumber = normalizePhone(dom.sellerPhoneInput.value);
    const evolutionInstance = dom.sellerEvolutionInput.value.trim();
    const active = Boolean(dom.sellerActiveInput.checked);

    if (!label || !phoneNumber || !evolutionInstance) {
        showToast("Preencha nome, numero e instancia Evolution.", "error");
        return;
    }

    dom.sellerSaveButton.disabled = true;

    try {
        if (state.sellerFormMode === "edit" && state.editingInstanceId) {
            await apiRequest(`/api/instances/${encodeURIComponent(state.editingInstanceId)}`, {
                method: "PATCH",
                body: {
                    label,
                    phoneNumber,
                    evolutionInstance,
                    active,
                },
            });

            showToast("Dados da vendedora atualizados.");
            state.selectedInstanceId = state.editingInstanceId;
            setSellerFormCreateMode();
            await refreshDashboard({ preserveSelection: true });
            return;
        }

        const instanceId = normalizeInstanceId(dom.sellerIdInput.value);
        if (!instanceId) {
            showToast("Informe um ID de instancia valido.", "error");
            return;
        }

        const provision = dom.sellerProvisionInput.checked;
        const payload = await apiRequest(`/api/instances?provision=${provision ? "true" : "false"}`, {
            method: "POST",
            body: {
                id: instanceId,
                label,
                phoneNumber,
                evolutionInstance,
                active,
            },
        });

        state.selectedInstanceId = instanceId;
        setSellerFormCreateMode();
        await refreshDashboard({ preserveSelection: true });

        if (payload?.integration?.warnings?.length) {
            showToast(`Cadastrada com avisos: ${payload.integration.warnings.join(" | ")}`, "error");
        } else {
            showToast("Vendedora cadastrada com sucesso.");
        }
    } catch (error) {
        handleApiError(error);
    } finally {
        dom.sellerSaveButton.disabled = false;
    }
}

function getSellerById(instanceId) {
    return state.sellers.find((item) => item.instanceId === instanceId) || null;
}

function normalizeInstanceId(value) {
    return String(value || "")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "");
}

async function loadConversationsForInstance(instanceId, { preserveConversation }) {
    state.selectedInstanceId = instanceId;
    renderSellerList();

    const seller = getSellerById(instanceId);
    dom.conversationTitle.textContent = seller?.sellerLabel || instanceId;
    dom.conversationMeta.textContent = seller
        ? `${seller.phoneNumber || "-"} | ${seller.evolutionInstance || "-"}`
        : "Carregando conversas...";

    setComposerAvailability(null);
    state.messages = [];
    dom.messagesFeed.innerHTML = '<div class="empty-state">Carregando conversas...</div>';
    dom.threadsList.innerHTML = '<div class="empty-state">Carregando...</div>';

    const params = new URLSearchParams();
    const receivedAfter = getReceivedAfterFromRange();
    if (receivedAfter) {
        params.set("receivedAfter", receivedAfter);
    }

    try {
        const payload = await apiRequest(
            `/api/instances/${encodeURIComponent(instanceId)}/conversations?${params.toString()}`
        );
        state.conversations = payload.data || [];
        state.selectedOriginTag = payload.originTag || null;

        if (
            !preserveConversation ||
            !state.conversations.some((item) => item.conversationId === state.selectedConversationId)
        ) {
            state.selectedConversationId = state.conversations[0]?.conversationId || null;
        }

        renderThreads();

        if (state.selectedConversationId) {
            await loadMessagesForConversation(instanceId, state.selectedConversationId);
        } else {
            setComposerAvailability(null);
            renderEmptyConversation("Nenhuma conversa encontrada para esta vendedora.");
        }
    } catch (error) {
        handleApiError(error);
        state.conversations = [];
        state.selectedConversationId = null;
        renderThreads();
        renderEmptyConversation("Nao foi possivel carregar as conversas desta vendedora.");
    }
}

async function loadMessagesForConversation(instanceId, conversationId) {
    const seller = getSellerById(instanceId);
    const conversation = getConversationById(conversationId);
    state.selectedConversationId = conversationId;
    renderThreads();

    dom.conversationTitle.textContent =
        conversation?.displayName || conversation?.contactDisplay || seller?.sellerLabel || instanceId;
    dom.conversationMeta.textContent = seller
        ? `${seller.sellerLabel || seller.instanceId} | ${
              conversation?.isGroup ? "Grupo" : "Individual"
          } | ${conversation?.participantDisplay || conversation?.contactPhone || conversationId}`
        : conversationId;

    setComposerAvailability(seller);

    const params = new URLSearchParams();
    params.set("limit", "120");
    params.set("conversationId", conversationId);
    const receivedAfter = getReceivedAfterFromRange();
    if (receivedAfter) {
        params.set("receivedAfter", receivedAfter);
    }

    dom.messagesFeed.innerHTML = '<div class="empty-state">Carregando mensagens...</div>';

    try {
        const payload = await apiRequest(
            `/api/instances/${encodeURIComponent(instanceId)}/messages?${params.toString()}`
        );
        state.messages = payload.data || [];
        state.selectedOriginTag = payload.originTag || null;

        renderMessages();
        prefillRecipientFromConversation(conversation);
    } catch (error) {
        handleApiError(error);
        renderEmptyConversation("Nao foi possivel carregar as mensagens desta conversa.");
    }
}

function renderThreads() {
    dom.threadsCounter.textContent = String(state.conversations.length);

    if (!state.conversations.length) {
        dom.threadsList.innerHTML = '<div class="empty-state">Sem conversas.</div>';
        return;
    }

    dom.threadsList.innerHTML = state.conversations
        .map((item) => {
            const active = item.conversationId === state.selectedConversationId ? "active" : "";
            const preview = item.lastTextBody || getMessageTypeLabel(item.lastMessageType);
            const title = item.displayName || item.contactDisplay || item.contactPhone || item.conversationId;
            const subtitle = item.isGroup
                ? `Grupo | ultimo: ${item.participantDisplay || "participante"}`
                : "Individual";

            return `
        <button class="thread-item ${active}" type="button" data-conversation-id="${escapeHtml(item.conversationId)}">
          <span class="thread-topline">
            ${renderAvatar(item.avatarUrl, title, "thread-avatar")}
            <span class="thread-copy">
              <span class="thread-title">${escapeHtml(title)}</span>
              <span class="thread-sub">${escapeHtml(subtitle)}</span>
            </span>
          </span>
          <span class="thread-preview">${Number(item.totalMessages || 0)} msgs | ${formatDateTime(item.lastMessageAt)}</span>
          <span class="thread-preview">${escapeHtml(preview.slice(0, 72))}</span>
        </button>
      `;
        })
        .join("");
}

async function onThreadItemClick(event) {
    const threadButton = event.target.closest("[data-conversation-id]");
    if (!threadButton || !state.selectedInstanceId) {
        return;
    }

    const conversationId = threadButton.getAttribute("data-conversation-id");
    if (!conversationId || conversationId === state.selectedConversationId) {
        return;
    }

    await loadMessagesForConversation(state.selectedInstanceId, conversationId);
}

function getConversationById(conversationId) {
    return state.conversations.find((item) => item.conversationId === conversationId) || null;
}

function setComposerAvailability(seller) {
    const isEnabled = Boolean(seller && seller.active);

    dom.recipientInput.disabled = !isEnabled;
    dom.messageInput.disabled = !isEnabled;
    dom.sendButton.disabled = !isEnabled;

    if (isEnabled) {
        dom.sendButton.textContent = "Enviar mensagem";
        return;
    }

    dom.sendButton.textContent = seller ? "Instancia inativa" : "Selecione uma vendedora";
}

function renderMessages() {
    if (!state.messages.length) {
        renderEmptyConversation("Sem mensagens no periodo selecionado.");
        return;
    }

    dom.messagesFeed.innerHTML = state.messages
        .slice()
        .reverse()
        .map((message) => {
            const outgoing = Boolean(message.fromMe);
            const cssClass = outgoing ? "outgoing" : "incoming";
            const author = outgoing
                ? message.isGroup
                    ? message.contactDisplay || "Saida da instancia"
                    : "Saida da instancia"
                : message.contactDisplay || normalizeJid(message.fromJid || message.chatJid || "Contato");
            const body = message.textBody || getMessageTypeLabel(message.messageType);

            return `
        <article class="message-item ${cssClass}">
          <div class="message-meta message-meta-rich">
            ${renderAvatar(message.avatarUrl, author, "message-avatar")}
            <span class="message-author-block">
              <span>${escapeHtml(author)}</span>
              <span class="message-context">${escapeHtml(message.isGroup ? message.groupName || "Grupo" : "Individual")}</span>
            </span>
            <span>${formatDateTime(message.receivedAt)}</span>
          </div>
          ${renderMessageMedia(message)}
          <div class="message-body">${escapeHtml(body)}</div>
        </article>
      `;
        })
        .join("");

    dom.messagesFeed.scrollTop = dom.messagesFeed.scrollHeight;
}

function renderEmptyConversation(message) {
    dom.messagesFeed.innerHTML = `<div class="empty-state">${escapeHtml(message)}</div>`;
}

function renderAvatar(avatarUrl, label, className) {
    if (avatarUrl) {
        return `<img class="${className}" src="${escapeHtml(avatarUrl)}" alt="${escapeHtml(label || "Avatar")}" loading="lazy" />`;
    }

    const initial = String(label || "?").trim().charAt(0).toUpperCase() || "?";
    return `<span class="${className} avatar-fallback">${escapeHtml(initial)}</span>`;
}

function prefillRecipientFromMessages() {
    if (dom.recipientInput.value.trim()) {
        return;
    }

    const inboundMessage = state.messages.find(
        (item) => !item.fromMe && (item.contactPhone || item.contactJid || item.fromJid || item.chatJid)
    );
    if (!inboundMessage) {
        return;
    }

    const candidate = inboundMessage.contactPhone || inboundMessage.contactJid || inboundMessage.fromJid || inboundMessage.chatJid;
    dom.recipientInput.value = normalizePhone(candidate);
}

function renderMessageMedia(message) {
    if (message.mediaThumbnail) {
        return `<img class="message-media" src="${escapeHtml(message.mediaThumbnail)}" alt="Imagem recebida" />`;
    }

    if (message.mediaType === "image") {
        return '<div class="message-media-placeholder">Imagem recebida sem miniatura disponivel</div>';
    }

    return "";
}

function getMessageTypeLabel(messageType) {
    const labels = {
        imageMessage: "Imagem",
        videoMessage: "Video",
        audioMessage: "Audio",
        stickerMessage: "Figurinha",
        documentMessage: "Documento",
    };

    return labels[messageType] || "Mensagem sem texto";
}

function prefillRecipientFromConversation(conversation) {
    dom.recipientInput.value = "";

    if (conversation?.contactPhone || conversation?.contactJid) {
        dom.recipientInput.value = normalizePhone(conversation.contactPhone || conversation.contactJid);
        return;
    }

    prefillRecipientFromMessages();
}

async function onSendSubmit(event) {
    event.preventDefault();

    const seller = getSellerById(state.selectedInstanceId);
    if (!state.selectedInstanceId || !seller || !seller.active) {
        showToast("Selecione uma vendedora ativa antes de enviar.", "error");
        return;
    }

    const to = normalizePhone(dom.recipientInput.value);
    const text = dom.messageInput.value.trim();

    if (!to || !text) {
        showToast("Informe numero e mensagem para enviar.", "error");
        return;
    }

    dom.sendButton.disabled = true;
    dom.sendButton.textContent = "Enviando...";

    try {
        await apiRequest(`/api/instances/${encodeURIComponent(state.selectedInstanceId)}/send`, {
            method: "POST",
            body: { to, text },
        });

        dom.messageInput.value = "";
        showToast("Mensagem enviada pela instancia selecionada.");
        await refreshDashboard({ preserveSelection: true });
    } catch (error) {
        handleApiError(error);
    } finally {
        setComposerAvailability(getSellerById(state.selectedInstanceId));
    }
}

function onRangeSelected(range) {
    if (!RANGE_MS.hasOwnProperty(range)) {
        return;
    }

    state.selectedRange = range;
    dom.rangeButtons.forEach((button) => {
        button.classList.toggle("active", button.dataset.range === range);
    });

    if (state.selectedInstanceId) {
        loadConversationsForInstance(state.selectedInstanceId, { preserveConversation: true });
    }
}

function getReceivedAfterFromRange() {
    const rangeMs = RANGE_MS[state.selectedRange];
    if (!rangeMs) {
        return null;
    }

    return new Date(Date.now() - rangeMs).toISOString();
}

function showLogin() {
    dom.loginView.classList.remove("hidden");
    dom.dashboardView.classList.add("hidden");
    dom.passwordInput.value = "";
}

function showDashboard() {
    dom.loginView.classList.add("hidden");
    dom.dashboardView.classList.remove("hidden");
    dom.userBadge.textContent = state.user ? `${state.user.name} (${state.user.role})` : "Admin";
}

function setLoginLoading(isLoading) {
    dom.loginButton.disabled = isLoading;
    dom.loginButton.textContent = isLoading ? "Entrando..." : "Entrar no painel";
}

function setDashboardLoading(isLoading) {
    dom.refreshAllButton.disabled = isLoading;
    dom.refreshAllButton.textContent = isLoading ? "Atualizando..." : "Atualizar";
}

function setLoginError(message) {
    if (!message) {
        dom.loginError.textContent = "";
        dom.loginError.classList.add("hidden");
        return;
    }

    dom.loginError.textContent = message;
    dom.loginError.classList.remove("hidden");
}

function clearSession() {
    state.token = "";
    state.user = null;
    state.sellers = [];
    state.origins = [];
    state.audits = [];
    state.messages = [];
    state.conversations = [];
    state.selectedInstanceId = null;
    state.selectedConversationId = null;
    state.selectedOriginTag = null;
    setSellerFormCreateMode();
    hideQrCard();
    localStorage.removeItem(TOKEN_KEY);
}

async function apiRequest(url, options = {}) {
    const method = options.method || "GET";
    const headers = {
        Accept: "application/json",
        "x-request-id": createRequestId(),
        ...(options.headers || {}),
    };

    if (options.auth !== false && state.token) {
        headers.Authorization = `Bearer ${state.token}`;
    }

    let body;
    if (options.body !== undefined) {
        headers["Content-Type"] = "application/json";
        body = JSON.stringify(options.body);
    }

    const response = await fetch(url, {
        method,
        headers,
        body,
    });

    const payload = await parseResponsePayload(response);

    if (!response.ok) {
        if (response.status === 401 && options.auth !== false) {
            clearSession();
            showLogin();
            showToast("Sessao expirada. Entre novamente.", "error");
        }

        const error = new Error(payload.error || `Erro HTTP ${response.status}`);
        error.status = response.status;
        error.payload = payload;
        throw error;
    }

    return payload;
}

async function parseResponsePayload(response) {
    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
        return response.json();
    }

    const text = await response.text();
    return text ? { raw: text } : {};
}

function handleApiError(error) {
    showToast(error.message || "Falha na operacao.", "error");
}

function createRequestId() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
        return window.crypto.randomUUID();
    }

    return `panel-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
}

function showToast(message, type = "info") {
    const toast = document.createElement("div");
    toast.className = `toast ${type}`;
    toast.textContent = message;

    dom.toastArea.appendChild(toast);

    window.setTimeout(() => {
        toast.remove();
    }, 3200);
}

function getStatusClass(status) {
    const normalized = String(status || "unknown").toLowerCase();

    if (["open", "connected"].includes(normalized)) {
        return "connected";
    }

    if (["connecting", "qrcode", "qr"].includes(normalized)) {
        return "connecting";
    }

    if (["close", "closed", "disconnected", "error", "inactive"].includes(normalized)) {
        return "closed";
    }

    return "unknown";
}

function normalizeJid(value) {
    if (!value) {
        return "Contato";
    }

    return String(value).replace(/@.*/, "");
}

function normalizePhone(value) {
    if (!value) {
        return "";
    }

    return String(value)
        .replace(/@.*/, "")
        .replace(/[^0-9+]/g, "")
        .trim();
}

function formatDateTime(value) {
    if (!value) {
        return "-";
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return "-";
    }

    return date.toLocaleString("pt-BR", {
        dateStyle: "short",
        timeStyle: "short",
    });
}

function escapeHtml(value) {
    return String(value || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}
