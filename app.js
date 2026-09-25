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
const btnSave = document.getElementById('btn-save');
const btnExportPdf = document.getElementById('btn-export-pdf');
const saveStatus = document.getElementById('save-status');

// ==================== AUTHENTICATION ====================
auth.onAuthStateChanged((user) => {
    if (user) {
        currentUser = user;
        loginSection.classList.add('hidden');
        appSection.classList.remove('hidden');
        loadData();
    } else {
        currentUser = null;
        currentScriptId = null;
        loginSection.classList.remove('hidden');
        appSection.classList.add('hidden');
        if (scriptsUnsubscribe) scriptsUnsubscribe();
        if (foldersUnsubscribe) foldersUnsubscribe();
    }
});

loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;
    authError.textContent = '';

    try {
        await auth.signInWithEmailAndPassword(email, password);
        showToast('Sesión iniciada correctamente', 'success');
    } catch (error) {
        if (error.code === 'auth/user-not-found' || error.code === 'auth/invalid-credential') {
            try {
                await auth.createUserWithEmailAndPassword(email, password);
                showToast('Cuenta creada e iniciada', 'success');
            } catch (createError) {
                authError.textContent = 'Error al crear cuenta: ' + createError.message;
            }
        } else {
            authError.textContent = 'Error al iniciar sesión: ' + error.message;
        }
    }
});

document.getElementById('btn-logout').addEventListener('click', () => {
    saveScript(); // Intentar guardar antes de salir
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
        <span>${script.title || 'Sin Título'}</span>
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
                <span>${folder.name}</span>
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
    
    const newRef = db.collection(`users/${currentUser.uid}/scripts`);
    const docRef = await newRef.add({
        title: 'Nuevo Guion',
        content: '<div class="slugline">INT. ESCENA - DÍA</div><div class="action">Describe la acción...</div>',
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    
    openScript(docRef.id, { title: 'Nuevo Guion', content: '<div class="slugline">INT. ESCENA - DÍA</div><div class="action">Describe la acción...</div>' });
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
    scriptTitleEl.disabled = false;
    btnSave.disabled = false;
    btnExportPdf.disabled = false;
    
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
            <div style="text-align: center; color: #999; margin-top: 50px; font-family: sans-serif;">⬅️ Selecciona o crea un guion en el menú lateral.</div>
        </div>
    `;
    scriptTitleEl.value = '';
    scriptTitleEl.disabled = true;
    btnSave.disabled = true;
    btnExportPdf.disabled = true;
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
        await db.doc(`users/${currentUser.uid}/scripts/${currentScriptId}`).update({
            title: title,
            content: content,
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
btnSave.addEventListener('click', () => {
    saveScript();
    showToast('Guion guardado manualmente', 'success');
});

// Botón Exportar PDF
btnExportPdf.addEventListener('click', () => {
    if (!currentScriptId) return;

    btnExportPdf.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Generando...';
    btnExportPdf.disabled = true;

    const title = scriptTitleEl.value || 'Guion';
    
    // Una hoja PDF por cada página del editor (mismo diseño, saltos, (MORE)/(CONT'D) y números)
    const exportDiv = document.createElement('div');
    exportDiv.style.cssText = 'position:absolute;left:-9999px;top:0;width:8.5in;background:#fff';
    const src = [...pagesContainer.querySelectorAll('.page')];
    src.forEach((p, i) => {
        const c = p.cloneNode(true);
        c.removeAttribute('id'); c.contentEditable = 'false';
        c.querySelectorAll('[data-sg]').forEach(x => x.removeAttribute('data-sg'));
        c.style.cssText = 'box-shadow:none;margin:0;min-height:0;height:10.98in;page-break-after:' + (i < src.length - 1 ? 'always' : 'auto');
        exportDiv.appendChild(c);
    });
    document.body.appendChild(exportDiv);

    window.scrollTo(0, 0);

    const opt = {
        margin:       0,
        filename:     `${title}.pdf`,
        image:        { type: 'jpeg', quality: 0.98 },
        html2canvas:  { scale: 2, useCORS: true, scrollY: 0 },
        jsPDF:        { unit: 'in', format: 'letter', orientation: 'portrait' },
        pagebreak:    { mode: ['css'] }
    };

    html2pdf().set(opt).from(exportDiv).save().then(() => {
        btnExportPdf.innerHTML = '<i class="fa-solid fa-file-pdf"></i> Exportar PDF';
        btnExportPdf.disabled = false;
        document.body.removeChild(exportDiv);
        showToast('PDF Exportado correctamente', 'success');
    }).catch(e => {
        console.error("Error al exportar PDF: ", e);
        btnExportPdf.innerHTML = '<i class="fa-solid fa-file-pdf"></i> Exportar PDF';
        btnExportPdf.disabled = false;
        document.body.removeChild(exportDiv);
        showToast('Error al exportar PDF', 'error');
    });
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
