# Publication Élan web et Android 0.2.0

Cible : https://gillesarnaudasse65-web.github.io/elan-app/

Le dossier site/ contient 30 fichiers web et deux fichiers de distribution Android : downloads/elan-android-v0.2.0.apk et android-release.json. Seul site/ est publié, jamais les sources privées, bases de profils, exports personnels ou clés de signature.

Build complet SHA256 : e13db1535da4104b3712d40f79ef436b8d9e8e9873470856f39eb61990f3f50e
Source privée SHA256 : eed758637a5b92b97ba8bf63cacfa99880da3d743a42cae881fc29ad98535c0d
Commit de départ privé (pas celui de la cible publique) : 8d38021c22bebf3d4836e04389e22ce102c949d1
APK SHA256 : 6b30a58088a19f32c17eb1b6496afbb705aa3c94edf7c916012dd63459eab092
APK octets : 3768240

L’APK est ajouté après les builds Android et web ; il ne fait partie ni du précache ni des ressources PWA requises pour le hors ligne. Le même site sert le téléchargement, sans autre fournisseur ou API de publication. La validation de signature et les essais Android sont documentés séparément ; une vérification HTTP ne vaut pas installation sur un appareil.

Un push normal sur elan-publication déclenche le workflow de déploiement, déjà activé par le titulaire sur ce dépôt. Les actions officielles sont épinglées ; la garde Pages et les empreintes sont vérifiées avant upload. Aucun déploiement sur main, force-push ou changement du dépôt source privé n’est demandé.

Le rapport vérifie la racine et chacun des 32 fichiers (web, métadonnées et APK) par HTTPS, taille et SHA256. Il atteste séparément androidDownloadVerified et conserve les refus/échecs ; aucune réussite n’est annoncée avant verificationPassed:true. L’attestation est conservée sans force-push sur elan-publication-status.

L’application reste locale : les profils sont conservés sur chaque appareil/origine, sans compte ni synchronisation. Une nouvelle installation Android n’importe pas automatiquement les données du navigateur.
