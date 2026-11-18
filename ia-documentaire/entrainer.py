# %% [markdown]
# # Entraîner DocuBot (AFGC) — Hugging Face → Ollama
#
# Ce carnet apprend à un modèle de langue **Qwen3 4B Instruct** (licence Apache 2.0) à lire les
# questions posées à DocuBot, avec le jeu d'exemples fabriqué par DocuFlow. Il produit
# un fichier **`docubot-afgc.gguf`** et son **`Modelfile`**, à installer dans Ollama.
#
# **Avant de lancer :** menu *Exécution → Modifier le type d'exécution → GPU T4*, puis
# *Exécution → Tout exécuter*. Autorisez l'accès à Google Drive quand la fenêtre s'ouvre
# (tout au début). Rien d'autre à faire : le carnet récupère seul les exemples, et dépose le
# modèle dans **Mon Drive → DocuBot**. Comptez 30 à 45 minutes ; gardez l'onglet ouvert
# (sur téléphone : écran allumé, branché au chargeur).

# %%
# 1. Google Drive (là où le modèle sera déposé), puis les outils (versions éprouvées).
import os, sys, subprocess, shutil
SUR_COLAB = 'google.colab' in sys.modules
DRIVE = '/content/drive/MyDrive/DocuBot'
if SUR_COLAB:
    import torch
    if not torch.cuda.is_available():
        raise SystemExit('\n\n>>> PAS DE CARTE GRAPHIQUE. Menu Exécution → Modifier le type d\'exécution → choisir « T4 GPU » → Enregistrer, puis Exécution → Tout exécuter.\n')
    print('Carte graphique trouvée : on continue.')
    from google.colab import drive
    drive.mount('/content/drive')
    os.makedirs(DRIVE, exist_ok=True)
if SUR_COLAB or os.environ.get('INSTALLER') == '1':
    subprocess.run([sys.executable, '-m', 'pip', 'install', '-q', 'transformers==5.23.0', 'peft==0.21.3', 'trl==1.18.1',
                    'datasets==5.2.0', 'accelerate==1.16.0', 'bitsandbytes', 'sentencepiece', 'gguf'], check=True)
    if not os.path.exists('llama.cpp'):
        subprocess.run(['git', 'clone', '-q', '--depth', '1', 'https://github.com/ggml-org/llama.cpp'], check=True)
    subprocess.run([sys.executable, '-m', 'pip', 'install', '-q', '-r', 'llama.cpp/requirements/requirements-convert_hf_to_gguf.txt'], check=True)

# %%
# 2. Le jeu d'exemples (fabriqué par DocuFlow : node scripts/ia-documentaire/generer-jeu.js).
JEU = os.environ.get('JEU', 'jeu-docubot-entrainement.jsonl')
TEST = os.environ.get('TEST', 'jeu-docubot-test.jsonl')
# Les exemples (noms d'entreprise inventés) sont publiés avec DocuFlow : pas de fichier à choisir.
ADRESSE = os.environ.get('ADRESSE_JEU', 'https://afgc.vercel.app/ia')
import urllib.request
for f in (JEU, TEST):
    if not os.path.exists(f):
        urllib.request.urlretrieve(f'{ADRESSE}/{f}', f)
assert os.path.exists(JEU), f'{JEU} introuvable'
print(sum(1 for _ in open(JEU, encoding='utf-8')), 'exemples d\'entraînement')

# %%
# 3. Le modèle de départ et les réglages.
import torch, gc, json
from datasets import load_dataset
from transformers import AutoTokenizer, AutoModelForCausalLM, BitsAndBytesConfig
from peft import LoraConfig, PeftModel
from trl import SFTTrainer, SFTConfig

MODELE = os.environ.get('MODELE', 'Qwen/Qwen3-4B-Instruct-2507')
NOM = os.environ.get('NOM', 'docubot-afgc')
EPOQUES = float(os.environ.get('EPOQUES', '1'))
PAS_MAX = int(os.environ.get('PAS_MAX', '-1'))   # pour un essai rapide : PAS_MAX=20
GPU = torch.cuda.is_available()
BF16 = GPU and torch.cuda.is_bf16_supported()
print('Carte graphique :', torch.cuda.get_device_name(0) if GPU else 'aucune (essai sur processeur, très lent)')

tok = AutoTokenizer.from_pretrained(MODELE)
options = {'dtype': torch.bfloat16 if BF16 else (torch.float16 if GPU else torch.float32)}
if GPU:
    # 4 bits pendant l'entraînement : le modèle tient sur la carte T4 gratuite.
    options['quantization_config'] = BitsAndBytesConfig(load_in_4bit=True, bnb_4bit_quant_type='nf4',
                                                        bnb_4bit_compute_dtype=options['dtype'], bnb_4bit_use_double_quant=True)
    options['device_map'] = 'auto'
modele = AutoModelForCausalLM.from_pretrained(MODELE, **options)

# %%
# 4. L'entraînement (LoRA : seuls de petits « adaptateurs » sont appris, le modèle reste intact).
jeu = load_dataset('json', data_files=JEU, split='train')
reglages = SFTConfig(
    output_dir=f'{NOM}-lora', num_train_epochs=EPOQUES, max_steps=PAS_MAX,
    per_device_train_batch_size=4 if GPU else 1, gradient_accumulation_steps=4 if GPU else 1,
    learning_rate=2e-4, lr_scheduler_type='cosine', warmup_steps=0.03, logging_steps=10,
    save_strategy='no', max_length=1024, bf16=BF16, fp16=GPU and not BF16,
    gradient_checkpointing=GPU, report_to='none',
    completion_only_loss=True,  # n'apprend que les réponses, pas les questions
)
adaptateurs = LoraConfig(r=16, lora_alpha=32, lora_dropout=0.05, task_type='CAUSAL_LM',
                         target_modules=['q_proj', 'k_proj', 'v_proj', 'o_proj', 'gate_proj', 'up_proj', 'down_proj'])
entraineur = SFTTrainer(model=modele, args=reglages, train_dataset=jeu, processing_class=tok, peft_config=adaptateurs)
entraineur.train()
entraineur.model.save_pretrained(f'{NOM}-lora')
tok.save_pretrained(f'{NOM}-lora')
if SUR_COLAB:
    # Sauvegarde intermédiaire : si la session coupe pendant la conversion, l'apprentissage est gardé.
    shutil.copytree(f'{NOM}-lora', f'{DRIVE}/{NOM}-lora', dirs_exist_ok=True)

# %%
# 5. Un premier contrôle sur des questions jamais vues (noms différents de l'entraînement).
def lire(messages, n=120):
    texte = tok.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
    ids = tok(texte, return_tensors='pt').to(entraineur.model.device)
    with torch.no_grad():
        sortie = entraineur.model.generate(**ids, max_new_tokens=n, do_sample=False)
    return tok.decode(sortie[0][ids['input_ids'].shape[1]:], skip_special_tokens=True).strip()

if os.path.exists(TEST):
    essais = [json.loads(l) for l in open(TEST, encoding='utf-8')]
    essais = [e for e in essais if e['prompt'][0]['content'].startswith('Tu analyses')][:int(os.environ.get('NB_TEST', '60'))]
    justes = 0
    for e in essais:
        attendu = json.loads(e['completion'][0]['content'])
        try:
            lu = json.loads(lire(e['prompt']))
        except Exception:
            lu = {}
        justes += lu.get('intention') == attendu['intention']
    print(f'Intention juste : {justes}/{len(essais)} ({round(100 * justes / len(essais))} %)')

# %%
# 6. Fusion des adaptateurs dans le modèle, puis conversion pour Ollama (GGUF, 8 bits).
del modele, entraineur
gc.collect()
if GPU:
    torch.cuda.empty_cache()
base = AutoModelForCausalLM.from_pretrained(MODELE, dtype=torch.float16 if GPU else torch.float32)
fusionne = PeftModel.from_pretrained(base, f'{NOM}-lora').merge_and_unload()
fusionne.save_pretrained(f'{NOM}-fusionne')
tok.save_pretrained(f'{NOM}-fusionne')
del base, fusionne
gc.collect()
subprocess.run([sys.executable, 'llama.cpp/convert_hf_to_gguf.py', f'{NOM}-fusionne', '--outtype', 'q8_0', '--outfile', f'{NOM}.gguf'], check=True)

# %%
# 7. Le Modelfile d'Ollama, et le paquet à télécharger.
MODELFILE = '''FROM ./NOM.gguf
TEMPLATE """{{- if .System }}<|im_start|>system
{{ .System }}<|im_end|>
{{ end }}
{{- range $i, $_ := .Messages }}
{{- $last := eq (len (slice $.Messages $i)) 1 -}}
{{- if eq .Role "user" }}<|im_start|>user
{{ .Content }}<|im_end|>
{{ else if eq .Role "assistant" }}<|im_start|>assistant
{{ .Content }}{{ if not $last }}<|im_end|>
{{ end }}
{{- end }}
{{- if and (ne .Role "assistant") $last }}<|im_start|>assistant
{{ end }}
{{- end }}"""
PARAMETER stop "<|im_end|>"
PARAMETER stop "<|endoftext|>"
PARAMETER temperature 0.2
PARAMETER num_ctx 4096
'''.replace('NOM', NOM)
open('Modelfile', 'w', encoding='utf-8').write(MODELFILE)
subprocess.run(['zip', '-q', '-0', f'{NOM}.zip', f'{NOM}.gguf', 'Modelfile'], check=True)
print(f'Prêt : {NOM}.zip ({os.path.getsize(f"{NOM}.zip") / 1e9:.1f} Go)')
if SUR_COLAB:
    shutil.copy(f'{NOM}.zip', f'{DRIVE}/{NOM}.zip')
    print(f'Déposé dans Mon Drive → DocuBot → {NOM}.zip : à télécharger depuis le serveur.')
