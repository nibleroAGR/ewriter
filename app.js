// Configuración de Firebase proporcionada por el usuario
const firebaseConfig = {
    apiKey: "AIzaSyDVpaNVbN_odbvwUzLwLCJEvCcVaU58mFo",
    authDomain: "ewriter-ed922.firebaseapp.com",
    projectId: "ewriter-ed922",
    storageBucket: "ewriter-ed922.firebasestorage.app",
    messagingSenderId: "74648101150",
    appId: "1:74648101150:web:a390feefe57d65e09be90f",
    measurementId: "G-6JRYD7RS8P"
};

// Inicializar Firebase (Usando Compat API para soporte en archivo local file://)
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

const escHTML = t => { const d = document.createElement('i'); d.textContent = t == null ? '' : String(t); return d.innerHTML; };

// Estado Global
let currentUser = null;
let currentScriptId = null;
let autoSaveTimer = null;
let scriptsUnsubscribe = null;

// Elementos del DOM
const loginSection = document.getElementById('login-section');
const appSection = document.getElementById('app-section');
const loginForm = document.getElementById('login-form');
const authError = document.getElementById('auth-error');
const scriptListEl = document.getElementById('script-list');
const pagesContainer = document.getElementById('pages-container');
const scriptTitleEl = document.getElementById('script-title');
const btnTitlePage = document.getElementById('btn-titlepage');
const btnSave = document.getElementById('btn-save');
const btnExportPdf = document.getElementById('btn-export-pdf');
const btnExport = document.getElementById('btn-export');
const btnExportFountain = document.getElementById('btn-export-fountain');
const elementSelect = document.getElementById('element-select');
const btnGoogle = document.getElementById('btn-google');
const saveStatus = document.getElementById('save-status');

// ==================== AUTHENTICATION ====================
// La sesión se mantiene al cerrar el navegador (cada cuenta ve solo sus guiones).
auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch(() => {});

const googleProvider = new firebase.auth.GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

// Mensajes claros para los errores más habituales
function authMessage(error) {
    const map = {
        'auth/operation-not-supported-in-this-environment': 'El acceso con Google no funciona abriendo el archivo directamente (file://). Abre la app desde un servidor: Firebase Hosting o un servidor local (http://localhost).',
        'auth/unauthorized-domain': 'Este dominio no está autorizado. Añádelo en Firebase › Authentication › Settings › Authorized domains.',
        'auth/operation-not-allowed': 'Este método de acceso está desactivado. Actívalo en Firebase › Authentication › Sign-in method.',
        'auth/popup-closed-by-user': 'Se cerró la ventana de Google antes de terminar. Inténtalo de nuevo.',
        'auth/cancelled-popup-request': '',
        'auth/account-exists-with-different-credential': 'Ese correo ya tiene cuenta con otro método. Entra con correo y contraseña.',
        'auth/wrong-password': 'Contraseña incorrecta.',
        'auth/email-already-in-use': 'Ese correo ya tiene cuenta, pero la contraseña no coincide. Si la creaste con Google, usa «Continuar con Google».',
        'auth/weak-password': 'La contraseña debe tener al menos 6 caracteres.',
        'auth/invalid-email': 'El correo no es válido.',
        'auth/too-many-requests': 'Demasiados intentos. Espera un momento y vuelve a probar.',
        'auth/network-request-failed': 'Sin conexión con el servidor. Revisa tu conexión a internet.'
    };
    return error.code in map ? map[error.code] : (error.message || 'Error desconocido');
}

// Crea o actualiza el perfil del usuario en users/{uid}
async function upsertUserProfile(user) {
    try {
        await db.doc(`users/${user.uid}`).set({
            uid: user.uid,
            displayName: user.displayName || '',
            email: user.email || '',
            photoURL: user.photoURL || '',
            providers: user.providerData.map(p => p.providerId),
            lastLoginAt: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
    } catch (e) { console.warn('No se pudo actualizar el perfil', e); }
}

function renderUserChip(user) {
    const name = user.displayName || (user.email || '').split('@')[0] || 'Usuario';
    document.getElementById('user-name').textContent = name;
    document.getElementById('user-email').textContent = user.email || '';
    const img = document.getElementById('user-avatar');
    const initial = document.getElementById('user-initial');
    if (user.photoURL) {
        img.src = user.photoURL; img.referrerPolicy = 'no-referrer';
        img.classList.remove('hidden'); initial.classList.add('hidden');
    } else {
        img.classList.add('hidden'); initial.classList.remove('hidden');
        initial.textContent = name.charAt(0).toUpperCase();
    }
}

auth.onAuthStateChanged((user) => {
    if (user) {
        currentUser = user;
        loginSection.classList.add('hidden');
        appSection.classList.remove('hidden');
        renderUserChip(user);
        upsertUserProfile(user);
        loadData();
    } else {
        currentUser = null;
        resetEditor();
        allScripts = []; allFolders = [];
        loginSection.classList.remove('hidden');
        appSection.classList.add('hidden');
        if (scriptsUnsubscribe) scriptsUnsubscribe();
        if (foldersUnsubscribe) foldersUnsubscribe();
    }
});

// Resultado de un acceso por redirección (cuando el navegador bloquea la ventana emergente)
auth.getRedirectResult().catch(err => {
    if (err && err.code) authError.textContent = authMessage(err);
});

btnGoogle.addEventListener('click', async () => {
    authError.textContent = '';
    if (location.protocol === 'file:') {
        authError.textContent = authMessage({ code: 'auth/operation-not-supported-in-this-environment' });
        return;
    }
    btnGoogle.disabled = true;
    try {
        await auth.signInWithPopup(googleProvider);
        showToast('Sesión iniciada con Google', 'success');
    } catch (error) {
        if (error.code === 'auth/popup-blocked') {
            await auth.signInWithRedirect(googleProvider);
            return;
        }
        authError.textContent = authMessage(error);
    } finally {
        btnGoogle.disabled = false;
    }
});

loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('email').value.trim();
    const password = document.getElementById('password').value;
    authError.textContent = '';

    try {
        await auth.signInWithEmailAndPassword(email, password);
        showToast('Sesión iniciada', 'success');
    } catch (error) {
        if (error.code === 'auth/user-not-found' || error.code === 'auth/invalid-credential' || error.code === 'auth/invalid-login-credentials') {
            try {
                await auth.createUserWithEmailAndPassword(email, password);
                showToast('Cuenta creada', 'success');
            } catch (createError) {
                authError.textContent = authMessage(createError);
            }
        } else {
            authError.textContent = authMessage(error);
        }
    }
});

document.getElementById('btn-logout').addEventListener('click', async () => {
    await saveScript(); // Guardar antes de salir
    auth.signOut();
});

// ==================== FIRESTORE LOGIC ====================
let allScripts = [];
let allFolders = [];
let foldersUnsubscribe = null;
let draggedScriptId = null;

function loadData() {
    if (!currentUser) return;
    
    // Listen to Folders
    foldersUnsubscribe = db.collection(`users/${currentUser.uid}/folders`)
        .orderBy('createdAt', 'asc')
        .onSnapshot(snapshot => {
            allFolders = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            renderUI();
        });

    // Listen to Scripts
    scriptsUnsubscribe = db.collection(`users/${currentUser.uid}/scripts`)
        .orderBy('updatedAt', 'desc')
        .onSnapshot(snapshot => {
            allScripts = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            renderUI();
        });
}

function renderUI() {
    const archiveListEl = document.getElementById('archive-list');
    if(!scriptListEl || !archiveListEl) return;
    
    scriptListEl.innerHTML = '';
    archiveListEl.innerHTML = '';
    
    // 1. Renderizar Guiones Activos (sin archivar)
    const activeScripts = allScripts.filter(s => !s.isArchived);
    activeScripts.forEach(script => {
        scriptListEl.appendChild(createScriptElement(script));
    });
    if (!activeScripts.length) scriptListEl.innerHTML = '<p class="empty-list">Aún no tienes guiones. Pulsa «Nuevo guion» para empezar.</p>';

    // 2. Renderizar Carpetas en Archivo
    allFolders.forEach(folder => {
        archiveListEl.appendChild(createFolderElement(folder));
    });

    // 3. Renderizar Guiones Archivados
    const archivedScripts = allScripts.filter(s => s.isArchived);
    archivedScripts.forEach(script => {
        const scriptEl = createScriptElement(script);
        if(script.folderId && document.getElementById(`folder-content-${script.folderId}`)) {
            document.getElementById(`folder-content-${script.folderId}`).appendChild(scriptEl);
        } else {
            archiveListEl.appendChild(scriptEl);
        }
    });
}

function createScriptElement(script) {
    const div = document.createElement('div');
    div.className = `script-item ${currentScriptId === script.id ? 'active' : ''}`;
    div.draggable = true;
    div.innerHTML = `
        <span>${escHTML(script.title || 'Sin título')}</span>
        <i class="fa-solid fa-trash btn-icon" style="padding:4px; font-size:0.8rem; color:#ef4444;" data-id="${script.id}"></i>
    `;
    
    // Drag Start
    div.addEventListener('dragstart', (e) => {
        draggedScriptId = script.id;
        e.dataTransfer.setData('text/plain', script.id);
        div.style.opacity = '0.5';
    });
    
    div.addEventListener('dragend', () => {
        div.style.opacity = '1';
        draggedScriptId = null;
    });

    div.addEventListener('click', (e) => {
        if (e.target.classList.contains('fa-trash')) return;
        openScript(script.id, script);
    });
    
    div.querySelector('.fa-trash').addEventListener('click', async (e) => {
        e.stopPropagation();
        if(confirm('¿Eliminar este guion permanentemente?')) {
            await db.doc(`users/${currentUser.uid}/scripts/${script.id}`).delete();
            if (currentScriptId === script.id) resetEditor();
            showToast('Guion eliminado', 'info');
        }
    });

    return div;
}

let activeFolderCtxId = null;

function createFolderElement(folder) {
    const div = document.createElement('div');
    div.className = 'folder-item';
    div.dataset.folderId = folder.id;
    
    div.innerHTML = `
        <div class="folder-header">
            <div class="folder-title">
                <i class="fa-solid fa-folder"></i> 
                <span>${escHTML(folder.name)}</span>
            </div>
            <i class="fa-solid fa-chevron-down" style="font-size:0.7rem; color:#94a3b8;"></i>
        </div>
        <div class="folder-content" id="folder-content-${folder.id}"></div>
    `;

    const header = div.querySelector('.folder-header');
    let longPressTimer;

    function showContextMenu(e) {
        e.preventDefault();
        e.stopPropagation();
        activeFolderCtxId = folder.id;
        const ctxMenu = document.getElementById('folder-context-menu');
        
        let clientX = e.clientX;
        let clientY = e.clientY;
        
        if (e.touches && e.touches.length > 0) {
            clientX = e.touches[0].clientX;
            clientY = e.touches[0].clientY;
        }
        
        ctxMenu.style.left = `${clientX}px`;
        ctxMenu.style.top = `${clientY}px`;
        ctxMenu.classList.remove('hidden');
    }

    // Click derecho
    header.addEventListener('contextmenu', showContextMenu);

    // Pulsación larga (pantallas táctiles)
    header.addEventListener('touchstart', (e) => {
        longPressTimer = setTimeout(() => showContextMenu(e), 600);
    }, {passive: false}); // passive false para permitir event.preventDefault() si hace falta
    
    header.addEventListener('touchend', () => clearTimeout(longPressTimer));
    header.addEventListener('touchmove', () => clearTimeout(longPressTimer));

    // Dropzone logic
    div.addEventListener('dragover', (e) => {
        e.preventDefault();
        div.classList.add('drag-over');
    });
    div.addEventListener('dragleave', () => {
        div.classList.remove('drag-over');
    });
    div.addEventListener('drop', async (e) => {
        e.preventDefault();
        div.classList.remove('drag-over');
        const scriptId = e.dataTransfer.getData('text/plain') || draggedScriptId;
        if(scriptId) {
            // Mover guion a esta carpeta y archivar
            await db.doc(`users/${currentUser.uid}/scripts/${scriptId}`).update({
                isArchived: true,
                folderId: folder.id,
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            showToast('Movido a la carpeta', 'success');
        }
    });

    // Expand/Collapse folder
    div.querySelector('.folder-header').addEventListener('click', () => {
        const content = div.querySelector('.folder-content');
        content.classList.toggle('open');
        const icon = div.querySelector('.fa-chevron-down');
        if(content.classList.contains('open')) {
            icon.classList.replace('fa-chevron-down', 'fa-chevron-up');
        } else {
            icon.classList.replace('fa-chevron-up', 'fa-chevron-down');
        }
    });

    return div;
}

// Event Listeners globales para Dropzones raíz y Context Menu
scriptTitleEl.addEventListener('input', () => { if (currentScriptId) updateTitlePreview(); });

document.addEventListener('DOMContentLoaded', () => {
    // Context Menu Logic
    const ctxMenu = document.getElementById('folder-context-menu');
    const ctxRename = document.getElementById('ctx-rename');
    const ctxDelete = document.getElementById('ctx-delete');

    if(ctxMenu) {
        document.addEventListener('click', (e) => {
            if(!e.target.closest('#folder-context-menu')) {
                ctxMenu.classList.add('hidden');
                activeFolderCtxId = null;
            }
        });

        ctxRename.addEventListener('click', async () => {
            if(!activeFolderCtxId || !currentUser) return;
            const newName = prompt('Nuevo nombre de la carpeta:');
            if(newName) {
                await db.doc(`users/${currentUser.uid}/folders/${activeFolderCtxId}`).update({
                    name: newName,
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                });
            }
            ctxMenu.classList.add('hidden');
        });

        ctxDelete.addEventListener('click', async () => {
            if(!activeFolderCtxId || !currentUser) return;
            if(confirm('¿Eliminar esta carpeta de seguridad y todas las copias en su interior? No se puede deshacer.')) {
                const scriptsInFolder = allScripts.filter(s => s.folderId === activeFolderCtxId);
                for(let s of scriptsInFolder) {
                    await db.doc(`users/${currentUser.uid}/scripts/${s.id}`).delete();
                }
                await db.doc(`users/${currentUser.uid}/folders/${activeFolderCtxId}`).delete();
                showToast('Carpeta eliminada', 'info');
            }
            ctxMenu.classList.add('hidden');
        });
    }

    // Zona de Guiones Activos (Restaurar / Copiar desde Archivo)
    const scriptListElDrop = document.getElementById('script-list');
    if(scriptListElDrop) {
        scriptListElDrop.addEventListener('dragover', e => e.preventDefault());
        scriptListElDrop.addEventListener('drop', async (e) => {
            e.preventDefault();
            const scriptId = e.dataTransfer.getData('text/plain') || draggedScriptId;
            if(!scriptId) return;
            
            const scriptData = allScripts.find(s => s.id === scriptId);
            if(!scriptData) return;

            // Si venía del archivo, la usuaria pidió COPIA ("trabajar con copia")
            if(scriptData.isArchived) {
                const newRef = db.collection(`users/${currentUser.uid}/scripts`);
                await newRef.add({
                    title: `${scriptData.title} (Copia activa)`,
                    content: scriptData.content || '',
                    isArchived: false,
                    folderId: null,
                    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                });
                showToast('Copia extraída del archivo', 'success');
            } else {
                // Si ya estaba activo y lo soltaron aquí, aseguramos que pierda folderId si lo tenía
                await db.doc(`users/${currentUser.uid}/scripts/${scriptId}`).update({
                    isArchived: false,
                    folderId: null,
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                });
            }
        });
    }

    // Zona Raíz de Archivo (Archivar sin carpeta)
    const archiveListDrop = document.getElementById('archive-list');
    if(archiveListDrop) {
        archiveListDrop.addEventListener('dragover', e => {
            e.preventDefault();
            if(e.target === archiveListDrop) archiveListDrop.classList.add('drag-over');
        });
        archiveListDrop.addEventListener('dragleave', e => {
            if(e.target === archiveListDrop) archiveListDrop.classList.remove('drag-over');
        });
        archiveListDrop.addEventListener('drop', async (e) => {
            e.preventDefault();
            archiveListDrop.classList.remove('drag-over');
            const scriptId = e.dataTransfer.getData('text/plain') || draggedScriptId;
            // Solo actuar si soltaron directamente en el área principal, no dentro de una carpeta
            if(scriptId && (e.target === archiveListDrop || e.target.closest('.folder-item') === null)) {
                await db.doc(`users/${currentUser.uid}/scripts/${scriptId}`).update({
                    isArchived: true,
                    folderId: null,
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                });
                showToast('Movido al Archivo', 'success');
            }
        });
    }
    
    // Botón crear carpeta
    const btnNewFolder = document.getElementById('btn-new-folder');
    if(btnNewFolder) {
        btnNewFolder.addEventListener('click', async () => {
            if(!currentUser) return;
            const name = prompt('Nombre de la nueva carpeta:');
            if(!name) return;
            await db.collection(`users/${currentUser.uid}/folders`).add({
                name: name,
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            });
        });
    }
});

document.getElementById('btn-new-script').addEventListener('click', async () => {
    if (!currentUser) return;
    
    const content = '<div class="transition">FUNDIDO DE ENTRADA:</div><div class="slugline">INT. LUGAR - DÍA</div><div class="action">Describe la acción...</div>';
    const data = {
        ...newScriptDoc('Nuevo guion', content),
        author: currentUser.displayName || ''
    };
    const docRef = await db.collection(`users/${currentUser.uid}/scripts`).add(data);
    openScript(docRef.id, data);
});

function openScript(id, data) {
    // Guardar el actual si hay uno abierto antes de cambiar
    if (currentScriptId && currentScriptId !== id) {
        saveScript();
    }
    
    currentScriptId = id;
    
    pagesContainer.innerHTML = '';
    const firstPage = document.createElement('div');
    firstPage.className = 'page';
    firstPage.contentEditable = true;
    firstPage.spellcheck = false;
    firstPage.id = 'editor';
    firstPage.innerHTML = data.content || '<div class="action"><br></div>';
    pagesContainer.appendChild(firstPage);
    
    if(window.reflowPagination) {
        setTimeout(() => window.reflowPagination(firstPage), 50);
    }
    scriptTitleEl.value = data.title || '';
    scriptTitleEl.dataset.author = data.author || (currentUser.displayName || '');
    scriptTitleEl.dataset.contact = data.contact || '';
    scriptTitleEl.disabled = false;
    btnTitlePage.disabled = false;
    updateTitlePreview();
    btnSave.disabled = false;
    btnExport.disabled = false;
    elementSelect.disabled = false;
    
    // Resaltar el activo en la lista
    document.querySelectorAll('.script-item').forEach(item => item.classList.remove('active'));
    setTimeout(() => {
        const activeItem = Array.from(document.querySelectorAll('.script-item .fa-trash')).find(i => i.getAttribute('data-id') === id);
        if(activeItem) activeItem.parentElement.classList.add('active');
    }, 50);
    
    startAutoSave();
    if(window.updateStats) window.updateStats();
    showToast('Guion cargado', 'info');
}

function resetEditor() {
    currentScriptId = null;
    pagesContainer.innerHTML = `
        <div class="page" id="editor" contenteditable="false" spellcheck="false">
            <div class="empty-hint">Abre un guion de la lista o crea uno nuevo.</div>
        </div>
    `;
    scriptTitleEl.value = '';
    scriptTitleEl.dataset.author = '';
    scriptTitleEl.dataset.contact = '';
    scriptTitleEl.disabled = true;
    btnTitlePage.disabled = true;
    btnSave.disabled = true;
    btnExport.disabled = true;
    elementSelect.disabled = true;
    stopAutoSave();
    if(window.updateStats) window.updateStats();
}

async function saveScript() {
    if (!currentUser || !currentScriptId) return;
    
    let content = '';
    content = window.getScriptContent ? window.getScriptContent() : [...pagesContainer.querySelectorAll('.page')].map(p => p.innerHTML).join('');
    
    const title = scriptTitleEl.value || 'Sin Título';
    
    try {
        saveStatus.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Guardando...';
        const elements = htmlToElements(content);
        await db.doc(`users/${currentUser.uid}/scripts/${currentScriptId}`).update({
            title: title,
            content: content,                 // HTML (conserva negrita/cursiva)
            elements: elements,               // Estructura estándar: [{ type, text }]
            author: scriptTitleEl.dataset.author || '',
            contact: scriptTitleEl.dataset.contact || '',
            format: 'screenplay',
            schemaVersion: 2,
            ownerId: currentUser.uid,
            stats: {
                pages: pagesContainer.querySelectorAll('.page').length,
                scenes: elements.filter(e => e.type === 'slugline').length,
                words: elements.reduce((n, e) => n + (e.text.match(/\S+/g) || []).length, 0)
            },
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        
        setTimeout(() => {
            saveStatus.innerHTML = '<i class="fa-solid fa-cloud-check"></i> Guardado';
            setTimeout(() => { saveStatus.innerHTML = '<i class="fa-solid fa-cloud"></i> Autoguardado 10min'; }, 2000);
        }, 500);
        
    } catch (e) {
        showToast('Error al guardar', 'error');
        console.error(e);
    }
}

// Boton guardar manual
btnTitlePage.addEventListener('click', () => {
    if (!currentScriptId) return;
    const author = prompt('Autor o autora (aparece bajo "Escrito por"):', scriptTitleEl.dataset.author || '');
    if (author === null) return;
    const contact = prompt('Datos de contacto (una línea, o varias separadas por salto de línea):', scriptTitleEl.dataset.contact || '');
    if (contact === null) return;
    scriptTitleEl.dataset.author = author.trim();
    scriptTitleEl.dataset.contact = contact;
    updateTitlePreview();
    saveScript();
});

btnSave.addEventListener('click', () => {
    saveScript();
    showToast('Guion guardado manualmente', 'success');
});

// HTML de la portada (título, autor y contacto en la misma posición que un guion profesional).
// La usan tanto la vista previa del editor como la exportación a PDF, para que coincidan siempre.
function titlePageInnerHTML(title) {
    const esc = t => { const d = document.createElement('i'); d.textContent = t; return d.innerHTML; };
    const contact = (scriptTitleEl.dataset.contact || '').split('\n').map(x => x.trim()).filter(Boolean);
    return `
        <div style="position:absolute;top:3.25in;left:0;width:100%;text-align:center;font-weight:bold;text-transform:uppercase">${esc(title)}</div>
        ${scriptTitleEl.dataset.author ? `
        <div style="position:absolute;top:3.59in;left:0;width:100%;text-align:center">Escrito por</div>
        <div style="position:absolute;top:3.95in;left:0;width:100%;text-align:center">${esc(scriptTitleEl.dataset.author)}</div>` : ''}
        ${contact.length ? `<div style="position:absolute;top:8.83in;left:4.96in">${contact.map(esc).join('<br>')}</div>` : ''}`;
}

// Construye la portada como un elemento de página independiente (8.5x11in) para capturarla en el PDF
function buildTitlePage(title) {
    const el = document.createElement('div');
    el.style.cssText = "width:8.5in;height:11in;position:relative;background:#fff;font-family:'Courier Prime',Courier,monospace;font-size:12pt;line-height:12pt;color:#000;box-sizing:border-box;overflow:hidden";
    el.innerHTML = titlePageInnerHTML(title);
    return el;
}

// Mantiene la portada visible como primera "página" del editor (no editable, no cuenta como página de contenido)
function updateTitlePreview() {
    let el = document.getElementById('title-page-preview');
    if (!currentScriptId) { if (el) el.remove(); return; }
    if (!el) {
        el = document.createElement('div');
        el.id = 'title-page-preview';
        el.className = 'titlepage';
        pagesContainer.insertBefore(el, pagesContainer.firstChild);
    } else if (pagesContainer.firstChild !== el) {
        pagesContainer.insertBefore(el, pagesContainer.firstChild);
    }
    el.innerHTML = titlePageInnerHTML(scriptTitleEl.value || 'Guion');
}
window.updateTitlePreview = updateTitlePreview;

// Genera el PDF con una imagen por página (una portada + una por cada página del guion),
// en vez de depender del corte automático de html2pdf, que podía dejar una hoja en blanco.
async function exportScriptPdf(title) {
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ unit: 'in', format: 'letter', orientation: 'portrait' });

    const stage = document.createElement('div');
    stage.style.cssText = 'position:fixed;left:-9999px;top:0;background:#fff';
    document.body.appendChild(stage);

    const srcPages = [...pagesContainer.querySelectorAll('.page')];
    const pages = [buildTitlePage(title), ...srcPages.map(p => {
        const c = p.cloneNode(true);
        c.removeAttribute('id'); c.contentEditable = 'false';
        c.querySelectorAll('[data-sg]').forEach(x => x.removeAttribute('data-sg'));
        c.style.boxShadow = 'none';
        c.style.margin = '0';
        return c;
    })];

    try {
        for (let i = 0; i < pages.length; i++) {
            stage.innerHTML = '';
            stage.appendChild(pages[i]);
            const canvas = await html2canvas(pages[i], { scale: 2, useCORS: true, backgroundColor: '#ffffff' });
            const img = canvas.toDataURL('image/jpeg', 0.95);
            if (i > 0) pdf.addPage('letter', 'portrait');
            pdf.addImage(img, 'JPEG', 0, 0, 8.5, 11);
        }
    } finally {
        document.body.removeChild(stage);
    }
    pdf.save(`${title}.pdf`);
}

// Botón Exportar PDF
btnExportPdf.addEventListener('click', async () => {
    if (!currentScriptId) return;
    closeMenus();
    const label = btnExport.innerHTML;
    btnExport.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Generando PDF…';
    btnExport.disabled = true;

    const title = scriptTitleEl.value || 'Guion';
    const wasDark = document.body.classList.contains('dark');
    document.body.classList.remove('dark'); // el PDF siempre en papel blanco

    try {
        await exportScriptPdf(title);
        showToast('PDF exportado', 'success');
    } catch (e) {
        console.error("Error al exportar PDF: ", e);
        showToast('No se pudo exportar el PDF', 'error');
    } finally {
        if (wasDark) document.body.classList.add('dark');
        btnExport.innerHTML = label;
        btnExport.disabled = false;
    }
});

btnExportFountain.addEventListener('click', () => {
    if (!currentScriptId) return;
    closeMenus();
    const title = scriptTitleEl.value || 'Guion';
    const text = elementsToFountain(htmlToElements(window.getScriptContent()), {
        title, author: scriptTitleEl.dataset.author, contact: scriptTitleEl.dataset.contact
    });
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${title}.fountain`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    showToast('Fountain exportado', 'success');
});

// Autoguardado cada 10 min
function startAutoSave() {
    stopAutoSave();
    autoSaveTimer = setInterval(() => {
        if(currentScriptId) saveScript();
    }, 10 * 60 * 1000); // 10 minutos
}
function stopAutoSave() {
    if (autoSaveTimer) clearInterval(autoSaveTimer);
}

// ==================== TOAST NOTIFICATIONS ====================
function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    
    let icon = 'fa-info-circle';
    if(type === 'success') icon = 'fa-check-circle';
    if(type === 'error') icon = 'fa-exclamation-circle';
    
    toast.innerHTML = `<i class="fa-solid ${icon}"></i> <span>${message}</span>`;
    container.appendChild(toast);
    
    setTimeout(() => {
        toast.classList.add('fade-out');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// ==================== ESTRUCTURA DEL GUION ====================
// Igual que los editores online (Celtx, WriterDuet, Fountain): el guion es una lista
// ordenada de elementos, cada uno con su tipo y su texto.
const ELEMENT_TYPES = ['slugline', 'action', 'character', 'parenthetical', 'dialogue', 'transition', 'shot'];

function newScriptDoc(title, content) {
    return {
        title,
        content,
        elements: htmlToElements(content),
        author: '',
        contact: '',
        format: 'screenplay',
        schemaVersion: 2,
        ownerId: currentUser.uid,
        isArchived: false,
        folderId: null,
        stats: { pages: 1, scenes: 0, words: 0 },
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    };
}

function htmlToElements(html) {
    const tmp = document.createElement('div');
    tmp.innerHTML = html || '';
    return [...tmp.children].map(el => {
        const type = ELEMENT_TYPES.find(t => el.classList.contains(t)) || 'action';
        return { type, text: el.textContent.replace(/\u00a0/g, ' ').trim() };
    }).filter(e => e.text);
}

// Convierte a Fountain (formato de texto abierto que importan Final Draft, Highland, WriterDuet, etc.)
function elementsToFountain(elements, meta) {
    const out = [];
    out.push(`Title: ${meta.title}`);
    if (meta.author) { out.push('Credit: Escrito por'); out.push(`Author: ${meta.author}`); }
    const contact = (meta.contact || '').split('\n').map(x => x.trim()).filter(Boolean);
    if (contact.length) { out.push('Contact:'); contact.forEach(c => out.push(`    ${c}`)); }
    out.push('');

    const sceneRx = /^(INT|EXT|EST|INT\.?\/EXT|I\/E)[\.\s]/i;
    elements.forEach((e, i) => {
        const prev = elements[i - 1];
        const inDialogue = prev && /^(character|parenthetical|dialogue)$/.test(prev.type) && /^(parenthetical|dialogue)$/.test(e.type);
        if (!inDialogue && out.length) out.push('');
        const t = e.text;
        switch (e.type) {
            case 'slugline': out.push(sceneRx.test(t) ? t.toUpperCase() : '.' + t.toUpperCase()); break;
            case 'character': out.push((/[A-ZÁÉÍÓÚÑÜ]/i.test(t) ? '' : '@') + t.toUpperCase()); break;
            case 'parenthetical': out.push(`(${t.replace(/^\(|\)$/g, '')})`); break;
            case 'dialogue': out.push(t); break;
            case 'transition': out.push(/TO:$/i.test(t) ? t.toUpperCase() : '> ' + t.toUpperCase()); break;
            case 'shot': out.push(t.toUpperCase()); break;
            default: out.push(t === t.toUpperCase() && /[A-Z]/.test(t) ? '!' + t : t);
        }
    });
    return out.join('\n').replace(/\n{3,}/g, '\n\n') + '\n';
}

// ==================== INTERFAZ: menús, pestañas, tema, atajos ====================
function closeMenus() { document.querySelectorAll('.dropdown').forEach(m => m.classList.add('hidden')); }
function toggleMenu(btnId, menuId) {
    document.getElementById(btnId).addEventListener('click', (e) => {
        e.stopPropagation();
        const m = document.getElementById(menuId), open = m.classList.contains('hidden');
        closeMenus(); if (open) m.classList.remove('hidden');
    });
}
toggleMenu('btn-export', 'export-menu');
toggleMenu('user-chip', 'user-menu');
document.addEventListener('click', (e) => { if (!e.target.closest('.dropdown')) closeMenus(); });

document.querySelectorAll('.tab').forEach(tab => tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t === tab));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('hidden', p.dataset.panel !== tab.dataset.tab));
}));

const btnTheme = document.getElementById('btn-theme');
function applyTheme(dark) {
    document.body.classList.toggle('dark', dark);
    btnTheme.innerHTML = dark ? '<i class="fa-solid fa-sun"></i> Modo claro' : '<i class="fa-solid fa-moon"></i> Modo oscuro';
    try { localStorage.setItem('ewriter-theme', dark ? 'dark' : 'light'); } catch (e) {}
}
try { applyTheme(localStorage.getItem('ewriter-theme') === 'dark'); } catch (e) {}
btnTheme.addEventListener('click', () => { applyTheme(!document.body.classList.contains('dark')); closeMenus(); });

document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        if (currentScriptId) { saveScript(); showToast('Guion guardado', 'success'); }
    }
});

// Guardar al cerrar la pestaña (mejor esfuerzo)
window.addEventListener('beforeunload', () => { if (currentScriptId) saveScript(); });
