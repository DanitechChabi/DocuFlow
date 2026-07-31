const express = require('express');
const router = express.Router();
const requestDetailsController = require('../controllers/requestDetailsController');
const authMiddleware = require('../middlewares/authMiddleware');

router.use(authMiddleware);
router.get('/:id', requestDetailsController.getRequestDetails);

module.exports = router;
