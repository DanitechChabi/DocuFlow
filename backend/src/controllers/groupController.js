const groupService = require('../services/groupService');

exports.getGroups = async (req, res) => {
  const tenantId = req.user.tenant_id;
  try {
    const groups = await groupService.getGroups(tenantId);
    res.json(groups);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erreur lors de la récupération des groupes' });
  }
};

exports.createGroup = async (req, res) => {
  const tenantId = req.user.tenant_id;
  const groupData = req.body;
  try {
    const group = await groupService.createGroup(tenantId, groupData);
    res.status(201).json({ message: 'Groupe créé avec succès', group });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erreur lors de la création du groupe' });
  }
};

exports.getGroupById = async (req, res) => {
  const tenantId = req.user.tenant_id;
  const groupId = req.params.id;
  try {
    const group = await groupService.getGroupById(tenantId, groupId);
    if (!group) {
      return res.status(404).json({ message: 'Groupe non trouvé' });
    }
    res.json(group);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erreur lors de la récupération du groupe' });
  }
};

exports.updateGroup = async (req, res) => {
  const tenantId = req.user.tenant_id;
  const groupId = req.params.id;
  const groupData = req.body;
  try {
    const group = await groupService.updateGroup(tenantId, groupId, groupData);
    if (!group) {
      return res.status(404).json({ message: 'Groupe non trouvé' });
    }
    res.json({ message: 'Groupe mis à jour avec succès', group });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erreur lors de la mise à jour du groupe' });
  }
};

exports.deleteGroup = async (req, res) => {
  const tenantId = req.user.tenant_id;
  const groupId = req.params.id;
  try {
    const deleted = await groupService.deleteGroup(tenantId, groupId);
    if (!deleted) {
      return res.status(404).json({ message: 'Groupe non trouvé' });
    }
    res.json({ message: 'Groupe supprimé avec succès' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erreur lors de la suppression du groupe' });
  }
};

exports.addUserToGroup = async (req, res) => {
  const groupId = req.params.id;
  const { userId } = req.body;
  try {
    const result = await groupService.addUserToGroup(userId, groupId);
    res.status(201).json({ message: 'Utilisateur ajouté au groupe avec succès', result });
  } catch (err) {
    console.error(err);
    res.status(400).json({ message: err.message || 'Erreur lors de l\'ajout de l\'utilisateur au groupe' });
  }
};

exports.removeUserFromGroup = async (req, res) => {
  const groupId = req.params.id;
  const userId = req.params.userId;
  try {
    const deleted = await groupService.removeUserFromGroup(userId, groupId);
    if (!deleted) {
      return res.status(404).json({ message: 'Appartenance non trouvée' });
    }
    res.json({ message: 'Utilisateur retiré du groupe avec succès' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erreur lors du retrait de l\'utilisateur du groupe' });
  }
};

exports.getUsersInGroup = async (req, res) => {
  const groupId = req.params.id;
  try {
    const users = await groupService.getUsersInGroup(groupId);
    res.json(users);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erreur lors de la récupération des membres du groupe' });
  }
};

exports.getUserGroups = async (req, res) => {
  const userId = req.params.userId;
  try {
    const groups = await groupService.getUserGroups(userId);
    res.json(groups);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erreur lors de la récupération des groupes de l\'utilisateur' });
  }
};
