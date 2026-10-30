# Publication Élan web et Android 0.2.1

Cible : https://gillesarnaudasse65-web.github.io/elan-app/

Le dossier site/ contient 35 fichiers web et deux fichiers de distribution Android : downloads/elan-android-v0.2.1.apk et android-release.json. Seul site/ est publié, jamais les sources privées, bases de profils, exports personnels ou clés de signature.

Build complet SHA256 : 81ba7e5f9168d5151b222884a830e54794b3a746f70504f520f3ffb7f878d7c7
Source privée SHA256 : 355ce0e4f6354c967ee1afcaa5c920fecceb2f4efa74804ec8515e412137c0fc
Commit de départ privé (pas celui de la cible publique) : 8d38021c22bebf3d4836e04389e22ce102c949d1
APK SHA256 : 6a9c2695299374778f98208ac46b206d71812c2e59b998c5c3595b8a3dbba3af
APK octets : 3855907

L’APK est ajouté après les builds Android et web ; il ne fait partie ni du précache ni des ressources PWA requises pour le hors ligne. Le même site sert le téléchargement, sans autre fournisseur ou API de publication. La validation de signature et les essais Android sont documentés séparément ; une vérification HTTP ne vaut pas installation sur un appareil.

Un push normal sur elan-publication déclenche le workflow de déploiement, déjà activé par le titulaire sur ce dépôt. Les actions officielles sont épinglées ; la garde Pages et les empreintes sont vérifiées avant upload. Aucun déploiement sur main, force-push ou changement du dépôt source privé n’est demandé.

Le rapport vérifie la racine et chacun des 37 fichiers (web, métadonnées et APK) par HTTPS, taille et SHA256. Il atteste séparément androidDownloadVerified et conserve les refus/échecs ; aucune réussite n’est annoncée avant verificationPassed:true. L’attestation est conservée sans force-push sur elan-publication-status.

L’application reste locale : les profils sont conservés sur chaque appareil/origine, sans compte ni synchronisation. Une nouvelle installation Android n’importe pas automatiquement les données du navigateur.
