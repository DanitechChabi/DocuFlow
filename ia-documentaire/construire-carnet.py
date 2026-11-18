# Construit le carnet Colab (entrainer-docubot.ipynb) à partir de entrainer.py :
# les cellules sont séparées par « # %% » (« # %% [markdown] » pour le texte).
#   python3 ia-documentaire/construire-carnet.py
import json, os, re
ici = os.path.dirname(os.path.abspath(__file__))
src = open(os.path.join(ici, 'entrainer.py'), encoding='utf-8').read()
cellules = []
for bloc in re.split(r'^# %%', src, flags=re.M)[1:]:
    texte = bloc.split('\n', 1)
    entete, corps = texte[0], (texte[1] if len(texte) > 1 else '')
    corps = corps.strip('\n')
    if '[markdown]' in entete:
        lignes = [l[2:] if l.startswith('# ') else l.lstrip('#') for l in corps.split('\n')]
        cellules.append({'cell_type': 'markdown', 'metadata': {}, 'source': [l + '\n' for l in lignes]})
    else:
        cellules.append({'cell_type': 'code', 'metadata': {}, 'execution_count': None, 'outputs': [], 'source': [l + '\n' for l in corps.split('\n')]})
for c in cellules:
    if c['source']:
        c['source'][-1] = c['source'][-1].rstrip('\n')
carnet = {'nbformat': 4, 'nbformat_minor': 0, 'cells': cellules,
          'metadata': {'colab': {'provenance': [], 'gpuType': 'T4'}, 'accelerator': 'GPU',
                       'kernelspec': {'name': 'python3', 'display_name': 'Python 3'}, 'language_info': {'name': 'python'}}}
for cible in [os.path.join(ici, 'entrainer-docubot.ipynb'), os.path.join(ici, '..', 'frontend', 'public', 'ia', 'entrainer-docubot.ipynb')]:
    os.makedirs(os.path.dirname(cible), exist_ok=True)
    json.dump(carnet, open(cible, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print('→', os.path.normpath(cible))
