# Publication Élan web et Android 0.2.2

Cible : https://gillesarnaudasse65-web.github.io/elan-app/

Le dossier site/ contient 35 fichiers web et deux fichiers de distribution Android : downloads/elan-android-v0.2.2.apk et android-release.json. Seul site/ est publié, jamais les sources privées, bases de profils, exports personnels ou clés de signature.

Build complet SHA256 : 0cd2e27730ba4ce22b96c2767af4d6af0f69ad133df3f6d5871f8eb1f483238d
Source privée SHA256 : 876d207c2a3a24742e09979d5ef5cca7fe38534c279ce29999aa1222bbd7ff8f
Commit de départ privé (pas celui de la cible publique) : 8d38021c22bebf3d4836e04389e22ce102c949d1
APK SHA256 : 2675a6374d3a976f9ee6dd9479cbaac71b7f85ebd7fc2b2ebb27c237aab48cf9
APK octets : 3867247

L’APK est ajouté après les builds Android et web ; il ne fait partie ni du précache ni des ressources PWA requises pour le hors ligne. Le même site sert le téléchargement, sans autre fournisseur ou API de publication. La validation de signature et les essais Android sont documentés séparément ; une vérification HTTP ne vaut pas installation sur un appareil.

Un push normal sur elan-publication déclenche le workflow de déploiement, déjà activé par le titulaire sur ce dépôt. Les actions officielles sont épinglées ; la garde Pages et les empreintes sont vérifiées avant upload. Aucun déploiement sur main, force-push ou changement du dépôt source privé n’est demandé.

Le rapport vérifie la racine et chacun des 37 fichiers (web, métadonnées et APK) par HTTPS, taille et SHA256. Il atteste séparément androidDownloadVerified et conserve les refus/échecs ; aucune réussite n’est annoncée avant verificationPassed:true. L’attestation est conservée sans force-push sur elan-publication-status.

L’application reste locale : les profils sont conservés sur chaque appareil/origine, sans compte ni synchronisation. Une nouvelle installation Android n’importe pas automatiquement les données du navigateur.
